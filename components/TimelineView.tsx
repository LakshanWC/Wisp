import React from "react";
import CollapsibleCategory from "./CollapsibleCategory";
import { type GroupMode } from "../scripts/bookmarkseparator";

//#region ─── TimeLineView ───
type TimelineViewProps = {
  categories: string[];
  getFiltered: (cat: string) => any[];
  meta: any;
  allCategoryNames: string[];
  onAssignCategory: (bookmarkId: string, categoryName: string) => void;
  groupMode: GroupMode;
  getCategoryIcon: (cat: string, mode: GroupMode) => string;
  theme: any,
  colors?: any 
  onDeleteBookmarks: (ids: string[]) => void;
  onUpdateUrl: (id: string, url: string) => void;
  onUpdateNote: (id: string, note: string) => void;
};

export default function TimelineView({
  categories,
  getFiltered,
  meta,
  allCategoryNames,
  onAssignCategory,
  groupMode,
  getCategoryIcon,
  theme,
  colors,
  onDeleteBookmarks,
  onUpdateUrl,
  onUpdateNote,
}: TimelineViewProps) {
  return (
    <div style={{ position: "relative", marginTop: "8px" }}>
      {categories.map((date, index) => {
        const bookmarks = getFiltered(date);
        const label = formatDateLabel(date);
        const isToday = label === "Today";
        const isYesterday = label === "Yesterday";
        const isSpecial = isToday || isYesterday;
        const isLast = index === categories.length - 1;

        return (
          <div
            key={date}
            style={{
              display: "grid",
              // Left col stretches to full row height so the line fills it
              gridTemplateColumns: "96px 1fr",
              gridTemplateRows: "1fr",
              gap: "0 20px",
              marginBottom: "8px",
              alignItems: "stretch",   // ← key: both cols fill the row height
            }}
          >
            {/* ── Left column: date label + dot + line ── */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                paddingTop: "20px",
                // This column now stretches to match the card height
              }}
            >
              {/* Date label */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: "2px",
                  marginBottom: "10px",
                  flexShrink: 0,
                }}
              >
                {isSpecial ? (
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: isToday ? "#a78bfa" : "#71717a",
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                    }}
                  >
                    {label}
                  </span>
                ) : (
                  <>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#a78bfa" }}>
                      {formatWeekday(date)}
                    </span>
                    <span style={{ fontSize: "12px", color: "#52525b", lineHeight: 1.2 }}>
                      {formatShortDate(date)}
                    </span>
                  </>
                )}
              </div>

              {/* Dot + line: this sub-column fills remaining left height */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: "100%",
                  flexGrow: 1,   // ← fills all remaining height in the left col
                }}
              >
                {/* Dot */}
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: isToday ? "#a78bfa" : "#3f3f46",
                    border: isToday ? "2px solid #7c3aed" : "2px solid #27272a",
                    flexShrink: 0,
                  }}
                />
                {/* Line — grows to fill the rest of the left column height */}
                {!isLast && (
                  <div
                    style={{
                      width: "2px",
                      flexGrow: 1,           // ← stretches to fill remaining space
                      minHeight: "32px",     // ensures a minimum visible length
                      marginTop: "6px",
                      background: "#27272a",
                      borderRadius: "1px",
                    }}
                  />
                )}
              </div>
            </div>

            {/* ── Right column: card ── */}
            <div style={{ paddingBottom: "16px" }}>
              <CollapsibleCategory
                title={`${getCategoryIcon(date, groupMode)} ${date}`}
                icon=""
                bookmarks={bookmarks.map((b: any) => ({
                  ...b,
                  description: meta[b.id]?.description,
                }))}
                defaultOpen={index === 0}
                categoryName={date}
                allCategories={allCategoryNames}
                onAssignCategory={onAssignCategory}
                onDeleteBookmarks={onDeleteBookmarks}
                onUpdateUrl={onUpdateUrl}
                onUpdateNote={onUpdateNote}  
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

//#endregion

//#region ─── Helper methods ───
function formatDateLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return "Today";
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function formatWeekday(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" });
  } catch {
    return "";
  }
}

function formatShortDate(dateStr: string): string {
  try {
    return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

//#endregion 