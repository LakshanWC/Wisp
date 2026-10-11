import React from "react"
import BookmarkCard from "./bookmarkcard"

interface Bookmark {
  id: number
  title: string
  description?: string
  url: string
  date?: string
  color?: string
}

interface BookmarkGridProps {
  bookmarks: Bookmark[]
  title?: string
}

//#region -- BookmarkGrid ---

export default function BookmarkGrid({ bookmarks, title = "All Bookmarks" }: BookmarkGridProps) {
  return (
    <div style={{ padding: "30px 20px" }}>
      {/* Header */}
      <div style={{ marginBottom: "30px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: "bold", margin: "0 0 8px 0" }}>
          {title}
        </h1>
        <p style={{ color: "#666", fontSize: "15px" }}>
          {bookmarks.length} bookmarks
        </p>
      </div>

      {/* Grid Container */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: "24px",
          justifyItems: "center",
        }}
      >
        {bookmarks.map((bookmark) => (
          <BookmarkCard
            key={bookmark.id}
            title={bookmark.title}
            description={bookmark.description}
            url={bookmark.url}
            date={bookmark.date}
            color={bookmark.color}
          />
        ))}
      </div>

      {bookmarks.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
          No bookmarks yet
        </div>
      )}
    </div>
  )
}
//#endregion