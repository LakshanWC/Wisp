import { AppUrls } from "./appUrls"



export function getUpdateDetails(){
   return fetchUpdateDetails();
}

const DETAILS_URL = AppUrls.RELEASE_JSON_URL;

const SUPPORTED_SCHEMA = 2;
const CACHE_KEY = "wisp_release_info";

async function fetchUpdateDetails() {
  try {
    const response = await fetch(DETAILS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);

    const data = await response.json();

    // ignore files from a newer structure than this extension understands
    if (typeof data.schemaVersion !== "number" || data.schemaVersion > SUPPORTED_SCHEMA) {
      throw new Error("Unsupported schema");
    }

    // save for next time
    await chrome.storage.local.set({
      [CACHE_KEY]: { data, fetchedAt: Date.now() }
    });
    return data;
  } catch (err) {
    console.warn("Could not fetch update details, using cache:", err);
    const cached = await chrome.storage.local.get(CACHE_KEY);
    return cached[CACHE_KEY]?.data ?? null;   // null if nothing cached yet
  }
}