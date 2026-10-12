# Wisp

Wisp is a modern browser extension built to help you organize, protect, and maintain your bookmarks with less hassle. It helps users detect broken links, find duplicates, manage private saved content, and browse bookmarks in a cleaner, more structured way.

Built with TypeScript and React, Wisp is designed for users who want a smarter bookmark experience without the clutter.

## Why Wisp?

Bookmark managers often feel outdated, hard to search, or difficult to organize. Wisp focuses on:
- keeping bookmarks easy to find
- surfacing broken or dead links
- removing duplicate entries
- protecting private bookmarks
- improving the overall extension experience

## Features

- Smart bookmark organization
- Dead link detection
- Duplicate bookmark detection
- Timeline and category-based browsing
- Private vault support for sensitive bookmarks
- Light and dark theme support
- Modern extension UI
- Browser storage integration
- Bug reporting tools and system diagnostics

## Tech Stack

- TypeScript
- React
- Plasmo
- Chrome/Chromium extension APIs
- CSS styling
- Browser storage APIs

## Project Structure

```bash
.
├── assets/
├── components/
├── intro/
├── scripts/
├── styles/
├── types/
├── .github/
├── .gitignore
├── .prettierrc.mjs
├── config
├── global.d.ts
├── options.tsx
├── package.json
├── popup.tsx
├── tsconfig.json
├── README.md
└── package-lock.json
```

## Getting Started

### Prerequisites

Make sure you have the following installed:

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/LakshanWC/Wisp.git
cd Wisp
npm install
```

## Development

Run the extension in development mode:

```bash
npm run dev
```

This starts the Plasmo development environment so you can test the extension in your browser.

## Production Build

To create a production build:

```bash
npm run build
```

This generates the packaged extension files for deployment or local testing.

## Loading the Extension

1. Open your browser’s extension page
2. Enable Developer Mode
3. Click “Load unpacked”
4. Select the generated build folder
5. Start using Wisp

## Permissions

Wisp requests browser permissions for functionality such as:

- bookmarks
- storage
- unlimited storage
- alarms

These permissions support bookmark management, persistence, and extension-level utilities.

## Screenshots



## Contributing

Contributions are welcome. If you want to improve the project:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Open a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Repository

- GitHub: https://github.com/LakshanWC/Wisp

## Summary

Wisp is a feature-focused browser extension designed to make bookmark management easier, safer, and more useful. Whether you want to clean up duplicates, monitor dead links, or protect private bookmarks, Wisp is built to help streamline the process.
```
