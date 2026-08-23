"use client";

import { useEffect, useState } from "react";

export default function MobileNav() {
    const [open, setOpen] = useState(false);

    // Lock body scroll when menu is open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "unset";
        }
        return () => {
            document.body.style.overflow = "unset";
        };
    }, [open]);

    return (
        <div className="md:hidden">
            {/* Hamburger button */}
            <button
                onClick={() => setOpen(!open)}
                className="relative w-10 h-10 flex items-center justify-center text-gray-900 z-50"
                aria-label="Toggle menu"
            >
                <div className="flex flex-col gap-1.5">
                    <span
                        className={`block w-6 h-0.5 bg-gray-900 transition-all duration-300 ease-in-out ${open ? "rotate-45 translate-y-2" : ""
                            }`}
                    />
                    <span
                        className={`block w-6 h-0.5 bg-gray-900 transition-all duration-300 ease-in-out ${open ? "opacity-0" : ""
                            }`}
                    />
                    <span
                        className={`block w-6 h-0.5 bg-gray-900 transition-all duration-300 ease-in-out ${open ? "-rotate-45 -translate-y-2" : ""
                            }`}
                    />
                </div>
            </button>

            {/* Mobile menu overlay */}
            <div
                className={`fixed left-0 right-0 bottom-0 top-16 z-40 bg-white border-t border-gray-200 h-[calc(100vh-4rem)] transition-all duration-300 ease-in-out ${open
                    ? "opacity-100 pointer-events-auto"
                    : "opacity-0 pointer-events-none"
                    }`}
                onClick={() => setOpen(false)}
            >
                <div
                    className={`flex flex-col items-center justify-center h-full gap-8 px-6 transition-all duration-300 ease-in-out ${open ? "translate-y-0 opacity-100" : "-translate-y-4 opacity-0"
                        }`}
                >
                    <a
                        href="mailto:nguyenquangminh570@gmail.com"
                        onClick={() => setOpen(false)}
                        className="text-xl text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        Contact
                    </a>
                    <a
                        href="https://t.me/blockads_android"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        className="text-xl text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        Telegram
                    </a>
                    <a
                        href="https://www.reddit.com/r/BlockAds/"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setOpen(false)}
                        className="text-xl text-gray-600 hover:text-gray-900 transition-colors"
                    >
                        Reddit
                    </a>
                </div>
            </div>
        </div>
    );
}
