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
  | `casting_map` | `Map` | Key-value pairs matching characters to voice IDs (e.g., `{"Narrator": "en-US-Chirp3-HD-Aoede", "Alice": "en-US-Journey-F"}`). |
  | `narrator_voice` | `String` \| `null` | The primary voice ID selected for generic narration. |
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
  | `content` | `String` | Raw narrative text, or SSML markup text enclosing dialogues in `<voice>` blocks. |
  | `voice_id` | `String` | Voice identifier used for narration or fallback. |
  | `is_ssml` | `Boolean` | Flag specifying if content contains SSML tagging. |
  | `created_at` | `Timestamp` | Server timestamp of chapter creation. |

* **Security Rules:**
  * **Read:** Allowed only if the authenticated user owns the parent `/titles/{title_id}` document.
  * **Write:** Restricted to the backend Admin SDK (returns `false` for direct client-side writes).

---

### 3. `chapter_sections`
Audiobook chapters are split into smaller paragraphs or SSML sections for synthesis limits and chunked streaming.

* **Document Path:** `/chapter_sections/{sectionId}`
* **Fields:**
  | Field Name | Type | Description |
  | :--- | :--- | :--- |
  | `id` | `String` | Unique UUID matching the document ID. |
  | `chapter_id` | `String` | Reference ID to the parent `/chapters/{chapterId}` document. |
  | `section_index` | `Number` | Ordering integer for this chunk within the chapter. |
  | `content` | `String` | Raw text or valid SSML sub-block (`<speak>...</speak>`) for this section. |
  | `status` | `String` | Audio generation status: `pending` or `generated`. |
  | `audio_file_path` | `String` \| `null` | Server local storage path to the synthesized MP3 file (e.g., `.../audio_files/{sectionId}.mp3`). |
  | `audio_url` | `String` \| `null` | URL endpoint reference to play back or download the section. |

* **Security Rules:**
  * **Read:** Allowed only if the authenticated user owns the grandparent `/titles/{titleId}` of this section's chapter.
  * **Write:** Restricted to the backend Admin SDK (returns `false` for direct client-side writes).
