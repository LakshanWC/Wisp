// bugReport.ts
import { AppUrls } from "./appUrls";
import {browserApi} from "~scripts/storage"

export enum BugReportType {
  BugReport = "Bug Report",
  Request   = "Request",
  Update    = "Update",
  Feature   = "Feature",
  Other     = "Other",
}

export interface BugReportObject {
  type: BugReportType;
  title: string;
  description: string;
  // attachment?: File; 
}

export function getCurrentInstalledVersion():string{
    const version = browserApi.runtime.getVersion()
    return version;
}

export function sendBugReport(formData: BugReportObject): void {
  const version = getCurrentInstalledVersion();
  const queryParams = new URLSearchParams({
    title: `[v${version}][${formData.type}] ${formData.title}`,
    body: formData.description,
    labels: formData.type,
  });

  const url = `${AppUrls.GITHUB_ISSUES}?${queryParams.toString()}`;
  window.open(url, "_blank", "noopener,noreferrer");
}