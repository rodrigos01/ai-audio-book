# Firestore Database Schema

This document details the structure of the Google Cloud Firestore database used by the AI Audio Book application.

---

## Owner ID Concept (`owner_id`)
To support both anonymous guests and registered users, ownership is established via a composite identifier format:
* **Anonymous Guest:** `client:<uuid>` (UUID generated on the client side or supplied by the backend cookies).
* **Registered User:** `user:<firebase-uid>` (The Firebase Authentication User UID).

When a guest user registers or logs in, the backend links their titles to their new registered UID by updating the `owner_id` field from `client:<uuid>` to `user:<firebase-uid>`.

---

## Collections

### 1. `titles`
Represents an audiobook project.

* **Document Path:** `/titles/{titleId}`
* **Fields:**
  | Field Name | Type | Description |
  | :--- | :--- | :--- |
  | `id` | `String` | Unique UUID matching the document ID. |
  | `name` | `String` | Name of the audiobook. |
  | `owner_id` | `String` | Ownership string: either `client:<clientId>` or `user:<userId>`. |
  | `ai_casting_enabled` | `Boolean` | Flag showing if AI character casting is active. |
  | `language` | `String` | Human-readable language of the text (e.g. `English`); mapped to a BCP-47 code for TTS. |
  | `voices` | `Map` | Per-character voices, keyed by the script speaker label (plus `Narrator`). Each value: `kind` (`named` = custom Voice Design voice, `supporting` = Voice Library voice), `gender`, `personality`, `description` (voice-only description used for design/matching), `origin` (`design` \| `library` \| `null` until resolved), `voiceId`, `fallback` (resolved via the other path after a failure, e.g. the 200-designed-voices-per-project quota), `pinned` (user-picked, never re-resolved), `hash` (inputs the current voice was resolved from), `aliasOf` (speaker uses another character's voice; set on `Narrator` for first-person narration). |
  | `casting_map` | `Map` | **Legacy** (pre-Gemini-3.8 titles): character -> old Chirp3/Gemini voice id. Still read as a fallback; mapped to a Voice Library voice. |
  | `narrator_voice` | `String` \| `null` | Voice Library id chosen by the user for narration; when null and AI casting is on, a narrator voice is designed (`voices.Narrator`). |
  | `narrator_personality` | `String` \| `null` | How the narrator should sound. |
  | `character_personalities` | `Map` | **Legacy** personality strings; new titles keep this in `voices`. |
  | `created_at` | `Timestamp` | Server timestamp of creation date. |

* **Security Rules:**
  * **Read:** Allowed only if the authenticated user's ID matches the `owner_id` suffix (`user:` + request.auth.uid).
  * **Write (Create):** Allowed if the user is authenticated.
  * **Update/Delete:** Allowed only if the authenticated user matches the `owner_id`.

---

### 2. `chapters`
Contains the textual or SSML content for individual audiobook sections/chapters.

* **Document Path:** `/chapters/{chapterId}`
* **Fields:**
  | Field Name | Type | Description |
  | :--- | :--- | :--- |
  | `id` | `String` | Unique UUID matching the document ID. |
  | `title_id` | `String` | Reference ID to the parent `/titles/{titleId}` document. |
  | `order_index` | `Number` | Sequence index of the chapter inside the book (1-indexed or 0-indexed). |
  | `name` | `String` \| `null` | Title or label for this specific chapter. |
  | `content` | `String` | Raw narrative text, or (after AI casting) a `Speaker: text` script: one turn per line, an optional leading `(style)` cue, inline `<laugh>`-style tags. Legacy chapters may still hold Chirp3 SSML. |
  | `voice_id` | `String` | Narrator voice: a Voice Library id if one was chosen, otherwise the literal `designed` (the narrator's voice is designed per title, see `titles.voices.Narrator`). Never null; never sent to the TTS API. |
  | `delivery_instruction` | `String` \| `null` | Chapter-wide tone/pacing directive from AI casting. |
  | `audio_version` | `Number` | Incremented whenever the chapter's audio is invalidated; offline downloads compare against it. |
  | `ai_casting_status` | `String` \| `null` | AI voice casting status: `'in_progress'`, `'completed'`, `'failed'`, or `null`. |
  | `created_at` | `Timestamp` | Server timestamp of chapter creation. |

* **Security Rules:**
  * **Read:** Allowed only if the authenticated user owns the parent `/titles/{title_id}` document.
  * **Write:** Restricted to the backend Admin SDK (returns `false` for direct client-side writes).

---

### 3. `chapter_sections`
Audiobook chapters are split into small sections (about 600-800 bytes, at most 2 distinct speakers each); one section is one Gemini TTS request and one HLS segment.

* **Document Path:** `/chapter_sections/{sectionId}`
* **Fields:**
  | Field Name | Type | Description |
  | :--- | :--- | :--- |
  | `id` | `String` | Unique UUID matching the document ID. |
  | `chapter_id` | `String` | Reference ID to the parent `/chapters/{chapterId}` document. |
  | `section_index` | `Number` | Ordering integer for this chunk within the chapter. |
  | `content` | `String` | Plain text or `Speaker: text` script lines for this section (legacy: SSML). |
  | `status` | `String` | Audio generation status: `pending` or `generated`. |
  | `audio_file_path` | `String` \| `null` | Storage path of the synthesized AAC file (`audio_files/v2/{sectionId}.aac`). |
  | `actual_duration` | `Number` \| omitted | Real length in seconds once synthesized; the HLS playlist declares it in `#EXTINF`. |
  | `estimated_start_time` / `estimated_duration` | `Number` | Estimates used before a section has been synthesized. |
  | `audio_url` | `String` \| `null` | URL endpoint reference to play back or download the section. |

* **Security Rules:**
  * **Read:** Allowed only if the authenticated user owns the grandparent `/titles/{titleId}` of this section's chapter.
  * **Write:** Restricted to the backend Admin SDK (returns `false` for direct client-side writes).
