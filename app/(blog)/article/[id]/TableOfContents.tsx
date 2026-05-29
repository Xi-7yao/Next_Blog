"use client"

import { useEffect, useState } from "react"

interface TocItem {
    id: string
    text: string
    level: number
}

export default function TableOfContents({ items }: { items: TocItem[] }) {
    const [activeId, setActiveId] = useState<string>("")

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting)
                if (visible.length > 0) {
                    setActiveId(visible[0].target.id)
                }
            },
            { rootMargin: "-80px 0px -60% 0px", threshold: 0 }
        )

        for (const item of items) {
            const el = document.getElementById(item.id)
            if (el) observer.observe(el)
        }

        return () => observer.disconnect()
    }, [items])

    if (items.length === 0) return null

    return (
        <nav className="sticky top-10 max-h-[calc(100vh-5rem)] overflow-y-auto">
            <h3 className="mb-3 text-sm font-medium text-gray-900">目录</h3>
            <ul className="space-y-1.5 border-l border-gray-200">
                {items.map((item) => (
                    <li
                        key={item.id}
                        style={{ paddingLeft: `${(item.level - 2) * 16 + 8}px` }}
                    >
                        <a
                            href={`#${item.id}`}
                            className={`block border-l py-1 text-sm transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded ${
                                activeId === item.id
                                    ? "-ml-px border-l border-gray-900 font-medium text-gray-900"
                                    : "border-l-transparent text-gray-500"
                            }`}
                        >
                            {item.text}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    )
}
