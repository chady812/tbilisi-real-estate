/**
 * Facebook GraphQL payload parser — pure text-in/posts-out helper.
 *
 * Facebook ships group-feed data in several envelopes: plain JSON (sometimes
 * behind the `for (;;);` guard), newline-delimited chunks, multipart/mixed
 * streamed parts, and JSON blobs embedded in inline `<script>` bootstraps
 * (`require("ScheduledServerJS")` handlers / relay prefetch streams). Instead
 * of trusting any single envelope — or hard-coded doc_ids / operation names
 * that Facebook rotates — every decoded payload is deep-scanned for feed
 * edges (`group_feed.edges`) and story-shaped objects (`__typename ===
 * 'Story'`, `post_id` / `legacy_fbid`), which are normalized into `RawFbPost`
 * records. Video/Reel detection and photo harvesting are owned by
 * `fbVideoRules.ts` / `fbPhotoRules.ts`: Rule 5 (a Reel/video story is never a
 * listing) is enforced at harvest time, multi-photo stories that merely carry an
 * extra clip stay in for the LLM drop rules, and a clip's thumbnail can never
 * become a lead photo. Media helpers: `fbJson.ts` (shared decoded-JSON
 * primitives) plus those two rule modules.
 * Never throws: malformed fragments are skipped, never fatal.
 */
import type { RawFbPost } from './fbGroup.js';
// Shared decoded-JSON primitives + media rules (video/Reel filtering and photo
// URL collection) — extracted so this module stays a pure decoder/scanner.
import { isRecord, isText, type JsonNode, type JsonRecord } from './fbJson.js';
import { collectPhotoUrls } from './fbPhotoRules.js';
import { PERMALINK_KEYS, findVideoSignal } from './fbVideoRules.js';

/** Facebook's `for (;;);` anti-XSS prefix on raw ajax/GraphQL bodies. */
const FOR_LOOP_GUARD = /^\s*for\s*\(;;\);\s*/;

/** Bare-Story ids usable inside a permalink — numeric or `pfbid…`. */
const POST_ID_PATTERN = /^(?:\d{8,}|pfbid\w+)$/;

/** URL fragments that identify a real post permalink. */
const PERMALINK_PATTERN = /\/posts\/|\/permalink\/|permalink\.php|story_fbid=|\/videos\/|\/reels?\//;

/** Payload markers that make a decoded fragment worth scanning for stories. */
const FEED_MARKER_PATTERN = /group_feed|Story|__bbox|relayPrefetchedStream|ScheduledServerJS/i;

/** Inline `<script>` bootstraps that carry embedded feed payloads. */
const SCRIPT_BLOCK_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const SCRIPT_MARKER_PATTERN = /ScheduledServerJS|relayPrefetchedStream|group_feed|__bbox/i;

/** Upper bound on script-body / smuggled-string size fed to the scanners. */
const MAX_SCAN_CHARS = 12_000_000;

/** Parses one JSON fragment, stripping the guard prefix; null when invalid. */
function tryParse(fragment: string): JsonNode | null {
  try { return JSON.parse(fragment.replace(FOR_LOOP_GUARD, '')) as JsonNode; } catch { return null; }
}

/** JSON.parse returning `unknown` — used to inspect string-literal payloads. */
function parseJsonLoose(fragment: string): unknown {
  try { return JSON.parse(fragment); } catch { return null; }
}

/**
 * Decodes every JSON payload inside a raw GraphQL body: the whole text
 * first, then newline-delimited chunks, then — for multipart/mixed streams —
 * each part's JSON body after its header block. Invalid pieces are skipped.
 */
function decodePayloads(rawText: string): JsonNode[] {
  const whole = tryParse(rawText);
  if (whole !== null) return [whole];
  const payloads: JsonNode[] = [];
  for (const line of rawText.split(/\r?\n/)) {
    const parsed = tryParse(line);
    if (parsed !== null) payloads.push(parsed);
  }
  for (const part of rawText.split(/(?:^|\r?\n)--[^\r\n]*/)) {
    const parsed = tryParse(part.replace(/^[\s\S]*?\r?\n\r?\n/, '').trim());
    if (parsed !== null) payloads.push(parsed);
  }
  return payloads;
}

/**
 * Pulls balanced JSON literals out of inline `<script>` bootstrap code:
 * plain objects (`ScheduledServerJS` `handle({...})` calls) plus JSON-encoded
 * string payloads (`relayPrefetchedStream` `inject(["…"])` calls).
 */
function decodeBalancedJson(code: string): JsonNode[] {
  const payloads: JsonNode[] = [];
  let depth = 0;
  let bracketStart = -1;
  let stringStart = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        inString = false;
        const literal = code.slice(stringStart, index + 1);
        if (literal.length > 2 && FEED_MARKER_PATTERN.test(literal)) {
          const decoded = parseJsonLoose(literal);
          const payload = typeof decoded === 'string' ? tryParse(decoded) : null;
          if (payload !== null) payloads.push(payload);
        }
      }
      continue;
    }
    if (char === '"') { inString = true; stringStart = index; continue; }
    if (char === '{' || char === '[') { if (depth === 0) bracketStart = index; depth += 1; continue; }
    if (char === '}' || char === ']') {
      depth = Math.max(0, depth - 1);
      if (depth === 0 && bracketStart >= 0) {
        const candidate = code.slice(bracketStart, index + 1);
        if (FEED_MARKER_PATTERN.test(candidate)) {
          const payload = tryParse(candidate);
          if (payload !== null) payloads.push(payload);
        }
        bracketStart = -1;
      }
    }
  }
  return payloads;
}

/**
 * Scans a rendered page's inline `<script>` blocks for embedded feed
 * payloads (first-load posts Facebook ships before any GraphQL response).
 */
export function parseFbEmbeddedPayloads(html: string, groupUrl: string): RawFbPost[] {
  if (!html.trim()) return [];
  const payloads: JsonNode[] = [];
  for (const match of html.matchAll(SCRIPT_BLOCK_PATTERN)) {
    const code = match[1] ?? '';
    if (code.length === 0 || code.length > MAX_SCAN_CHARS || !SCRIPT_MARKER_PATTERN.test(code)) continue;
    payloads.push(...decodeBalancedJson(code));
  }
  return scanPayloads(payloads, groupUrl);
}

/* ─── Subtree search helpers ────────────────────────────────────────────── */

/** First usable story identifier in the subtree, else null. `<group>_<post>`
 *  compounds collapse onto their suffix; `<post>_<comment>` pairs (prefix
 *  differing from the group id) are rejected as comment fragments. */
function findStoryId(node: JsonNode, groupRef: string | null): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const id = findStoryId(child, groupRef); if (id !== null) return id; }
  } else if (isRecord(node)) {
    if (isText(node.post_id)) {
      const compound = node.post_id.match(/^(\d+)_(\d+)$/);
      if (compound === null) return node.post_id.trim(); // pfbid / base64 / bare id.
      if (groupRef === null) return compound[2]; // No group context — assume `<group>_<post>`.
      return compound[1] === groupRef ? compound[2] : null; // `<post>_<comment>` → not a story id.
    }
    if (isText(node.legacy_fbid) && /^\d{5,}$/.test(node.legacy_fbid)) return node.legacy_fbid;
    if (node.__typename === 'Story' && isText(node.id) && POST_ID_PATTERN.test(node.id)) return node.id;
    for (const child of Object.values(node)) { const id = findStoryId(child, groupRef); if (id !== null) return id; }
  }
  return null;
}

/** First non-empty `message.text` anywhere in the subtree (covers the
 *  `comet_sections.content.story.message.*` nesting), else null. */
function findMessageText(node: JsonNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const text = findMessageText(child); if (text !== null) return text; }
  } else if (isRecord(node)) {
    if (isRecord(node.message) && isText(node.message.text)) return node.message.text.trim();
    for (const child of Object.values(node)) { const text = findMessageText(child); if (text !== null) return text; }
  }
  return null;
}

/** First permalink-bearing URL string at known story keys, depth-first. */
function findPermalink(node: JsonNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const url = findPermalink(child); if (url !== null) return url; }
  } else if (isRecord(node)) {
    for (const key of PERMALINK_KEYS) {
      const value = node[key];
      if (isText(value) && PERMALINK_PATTERN.test(value)) return value.trim();
    }
    for (const child of Object.values(node)) { const url = findPermalink(child); if (url !== null) return url; }
  }
  return null;
}


/** First display name in the subtree (`author_name`, or a named
 *  `User`/`Profile` actor record), else null. */
function findAuthorName(node: JsonNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const name = findAuthorName(child); if (name !== null) return name; }
  } else if (isRecord(node)) {
    if (isText(node.author_name)) return node.author_name.trim();
    if (isText(node.name) && typeof node.__typename === 'string' && /^(?:User|Profile|GroupUser)/.test(node.__typename)) {
      return node.name.trim();
    }
    for (const child of Object.values(node)) { const name = findAuthorName(child); if (name !== null) return name; }
  }
  return null;
}

/** First epoch `creation_time` / `created_time` in the subtree as ISO, else null. */
function findCreatedAt(node: JsonNode): string | null {
  if (Array.isArray(node)) {
    for (const child of node) { const at = findCreatedAt(child); if (at !== null) return at; }
  } else if (isRecord(node)) {
    for (const key of ['creation_time', 'created_time'] as const) {
      const value = node[key];
      if (typeof value === 'number' && value > 1e9) {
        return new Date(value > 1e12 ? value : value * 1000).toISOString();
      }
    }
    for (const child of Object.values(node)) { const at = findCreatedAt(child); if (at !== null) return at; }
  }
  return null;
}

/* ─── Video / Reel + photo rules (implementation: `fbVideoRules.ts`) ───── */

/**
 * `findVideoSignal()` — plus the `VIDEO_URL_PATTERN` / `VIDEO_TYPE_PATTERN` /
 * `VIDEO_KEYS` / `NON_MEDIA_KEYS` constants it uses — lives in
 * `fbVideoRules.ts`, and the photo-URL collector in `fbPhotoRules.ts`; together
 * they own every media decision. This module keeps only the harvest-time call
 * sites so the decoding/scan logic and the media rules evolve independently.
 */

/* ─── Story harvesting ──────────────────────────────────────────────────── */

/** Normalizes one story container's subtree into a deduped `RawFbPost`. */
function harvest(node: JsonRecord, groupRef: string | null, seen: Set<string>, posts: RawFbPost[]): void {
  const rawPermalink = findPermalink(node);
  // `?comment_id=` permalinks belong to feedback fragments, not stories —
  // skip those containers unless they are themselves story-shaped.
  if (rawPermalink !== null && /comment_id=/.test(rawPermalink) && node.__typename !== 'Story' && node.creation_time === undefined) return;
  const permalink = rawPermalink?.replace(/\?comment_id=[^&]+/, '') ?? null;
  const postId = findStoryId(node, groupRef) ?? permalink?.match(/(?:\/(?:posts|permalink)\/|story_fbid=)([^/?&#]+)/)?.[1] ?? null;
  const text = findMessageText(node);
  if (postId === null || (text === null && permalink === null)) return; // Need identity + parseable content.
  const path = permalink ?? (groupRef ? `/groups/${groupRef}/posts/${postId}` : null);
  if (path === null || seen.has(postId)) return;
  seen.add(postId); // Reserve the id first so duplicate story fragments can't double-log the skip.
  // Reels / short videos / video-first posts stop here — before the LLM and
  // the lead queue. Multi-photo stories that merely carry an extra clip stay
  // in; the LLM drop rules evaluate those instead.
  const media = findVideoSignal(node);
  if (media.hasVideo && !media.hasPhoto) {
    console.log(`🎬 [fbGraphQLParser] Skipped video/Reel post ${postId}.`);
    return;
  }
  posts.push({
    postId,
    postUrl: path.startsWith('http') ? path : `https://www.facebook.com${path}`,
    publishedAt: null, // Payloads carry epoch times, not the friendly label this field expects.
    rawText: text ?? '',
    // Attached photos, Rule-5 filtered by `fbPhotoRules.collectPhotoUrls`:
    // Reel/video resources, clip preview stills and video media subtrees never
    // reach a lead's `imageUrls` (photo-only posts included).
    imageUrls: collectPhotoUrls(node),
    authorName: findAuthorName(node),
    createdAt: findCreatedAt(node),
    rawPayload: node,
  });
}

/** Depth-first walk over every decoded payload fragment. */
function collectPosts(node: JsonNode, groupRef: string | null, seen: Set<string>, posts: RawFbPost[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectPosts(child, groupRef, seen, posts);
    return;
  }
  if (typeof node === 'string') {
    // Relay streams smuggle JSON inside string chunks — peel and walk them.
    const payload = node.length > 2 && node.length < MAX_SCAN_CHARS && /^[\[{]/.test(node) ? tryParse(node) : null;
    if (payload !== null) collectPosts(payload, groupRef, seen, posts);
    return;
  }
  if (!isRecord(node)) return;
  // Feed containers — `node.group_feed.edges` / `data.group_feed.edges` and
  // any wrapper Facebook adds. Harvest each edge AND its `node` child, since
  // `comet_sections` sometimes sits beside the story instead of inside it.
  if (isRecord(node.group_feed) && Array.isArray(node.group_feed.edges)) {
    for (const edge of node.group_feed.edges) {
      collectPosts(edge, groupRef, seen, posts);
      if (isRecord(edge) && isRecord(edge.node)) harvest(edge.node, groupRef, seen, posts);
    }
  }
  // Story-shaped objects anywhere in the tree — identity markers only, never
  // hard-coded doc_ids or operation names that Facebook rotates.
  if (
    node.__typename === 'Story' ||
    node.post_id !== undefined ||
    node.legacy_fbid !== undefined ||
    isRecord(node.comet_sections)
  ) {
    harvest(node, groupRef, seen, posts);
  }
  for (const child of Object.values(node)) collectPosts(child, groupRef, seen, posts);
}

/** Scans decoded payloads for stories and returns them in discovery order. */
function scanPayloads(payloads: JsonNode[], groupUrl: string): RawFbPost[] {
  const groupRef = groupUrl.match(/facebook\.com\/groups\/([^/?#]+)/i)?.[1] ?? null;
  const posts: RawFbPost[] = [];
  const seen = new Set<string>();
  try {
    for (const payload of payloads) collectPosts(payload, groupRef, seen, posts);
  } catch (error) {
    console.error(`❌ [fbGraphQLParser] Payload scan failed for ${groupUrl}:`, error);
  }
  if (posts.length > 0) console.log(`📨 [fbGraphQLParser] Parsed ${posts.length} post(s) from ${groupUrl}.`);
  return posts;
}

/**
 * Parses a Facebook GraphQL response — plain JSON, newline-delimited chunks
 * or multipart/mixed streams — into `RawFbPost[]`. Never throws: empty input
 * or payloads without recognizable post fragments yield `[]`.
 */
export function parseFbGraphQLPayload(rawText: string, groupUrl: string): RawFbPost[] {
  if (!rawText.trim()) return [];
  return scanPayloads(decodePayloads(rawText), groupUrl);
}