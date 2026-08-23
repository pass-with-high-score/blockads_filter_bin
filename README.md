# BlockAds Website 🛡️

The official landing page and compiler dashboard for the **[BlockAds](https://github.com/pass-with-high-score/blockads-android)** ecosystem.

BlockAds is a privacy-first, system-wide adblocker for Android that uses smart DNS filtering without requiring root access. This repository contains the Next.js frontend that serves as the main homepage and the interface for the backend filter compiler.

## Features ✨
- **Landing Page**: A modern, aesthetically pleasing landing page outlining features, FAQs, and open-source links.
- **Filter Compiler Dashboard**: Interface that allows users to compile custom DNS blocklists natively for the BlockAds DNS Engine (`.trie` & `.bloom` generated formats).
- **Recent Filters Browser**: Easily search, copy, and download recently updated or generated filter lists.
- **Glassmorphic & Premium UI**: High-quality, responsive layout utilizing Tailwind CSS.

## 🚀 Getting Started

First, ensure you have [Bun](https://bun.sh/) (or Node.js) installed locally.

Install the necessary dependencies:
```bash
bun install
```

Start the development server:
```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to view the application in action.

## 🛠️ Built With

- **[Next.js (App Router)](https://nextjs.org/)** - React framework for production
- **[Tailwind CSS](https://tailwindcss.com/)** - Utility-first CSS framework
- **[Lucide React](https://lucide.dev/)** - Beautiful & consistent icons
- **[Bun](https://bun.sh/)** - Fast JavaScript all-in-one toolkit

## 📄 License
This project is open-sourced software available under the **[MIT License](./LICENSE)**.
