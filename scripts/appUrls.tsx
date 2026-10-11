// this class contain all urls extention would need to fetch data or to use to report bugs or so
export class AppUrls {
  static readonly Baseurl = "https://github.com/LakshanWC/Wisp";
  static readonly RELEASE_JSON_URL = "https://raw.githubusercontent.com/LakshanWC/Wisp/main/release.json";
  static readonly GITHUB_ISSUES = AppUrls.Baseurl + "/issues/new";

  private constructor() {}
}