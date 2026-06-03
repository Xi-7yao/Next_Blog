"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { TocItem } from "@/app/lib/articles"

const HEADER_OFFSET = 40
const ACTIVE_RATIO = 0.25

function onScrollEnd(callback: () => void) {
    if ("onscrollend" in (window as any)) {
        window.addEventListener("scrollend", callback, { once: true });
        return () => window.removeEventListener("scrollend", callback);
    }
    let timer: ReturnType<typeof setTimeout>
    const onScroll = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
            window.removeEventListener("scroll", onScroll);
            callback();
        }, 100)
    }
    window.addEventListener("scroll", onScroll);
    return () => {
        clearTimeout(timer);
        window.removeEventListener("scroll", onScroll);
    }
}

export function useActiveHeading(items: TocItem[]) {
    const [activeId, setActiveId] = useState(() => items[0]?.id ?? "");
    const itemsRef = useRef(items);
    itemsRef.current = items;

    const intersectingRef = useRef(new Set<string>());
    const lockedRef = useRef(false);

    useEffect(() => {
        if (items.length === 0) return

        const rootMargin = `-${HEADER_OFFSET}px 0px -${(1 - ACTIVE_RATIO) * 100}% 0px`

        const observer = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        intersectingRef.current.add(entry.target.id);
                    } else {
                        intersectingRef.current.delete(entry.target.id);
                    }
                }

                if (lockedRef.current) return;

                for (const item of itemsRef.current) {
                    if (intersectingRef.current.has(item.id)) {
                        setActiveId(item.id);
                        return;
                    }
                }
            },
            { rootMargin }
        )

        for (const item of items) {
            const el = document.getElementById(item.id);
            if (el) observer.observe(el);
        }

        return () => observer.disconnect();
    }, [items])

    const navigateTo = useCallback((id: string) => {
        lockedRef.current = true;
        setActiveId(id);

        const el = document.getElementById(id);
        if (el) {
            const top = el.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET;
            window.scrollTo({ top, behavior: "smooth" });
            history.replaceState(null, "", `#${id}`);
        }

        onScrollEnd(() => {
            lockedRef.current = false;
            for (const item of itemsRef.current) {
                if (intersectingRef.current.has(item.id)) {
                    setActiveId(item.id);
                    return;
                }
            }
        })
    }, [])

    return [activeId, navigateTo] as const;
}

function TocList({
    items,
    activeId,
    onSelect,
    onNavigate,
}: {
    items: TocItem[]
    activeId: string
    onSelect: (id: string) => void
    onNavigate?: () => void
}) {
    return (
        <ul className="space-y-1">
            {items.map((item) => (
                <li key={item.id} className={item.level === 2 ? "ml-3" : ""}>
                    <a
                        href={`#${item.id}`}
                        onClick={(e) => { e.preventDefault(); onSelect(item.id); onNavigate?.() }}
                        className={`block rounded-r py-2.5 text-sm leading-relaxed transition-colors border-l-2 ${item.level === 2 ? "pl-4" : "pl-3"} ${activeId === item.id
                                ? "border-l-blue-500 bg-blue-50/60 text-gray-900 font-medium"
                                : "border-l-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-100/60"
                            }`}
                    >
                        {item.text}
                    </a>
                </li>
            ))}
        </ul>
    )
}

export function TocMobile({
    items,
    activeId,
    onSelect,
}: {
    items: TocItem[]
    activeId: string
    onSelect: (id: string) => void
}) {
    const [open, setOpen] = useState(false)
    if (items.length === 0) return null

    return (
        <div className="lg:hidden sticky top-0 z-10 -mx-5 mb-8 bg-white/95 backdrop-blur border-b border-gray-200">
            <button
                onClick={() => setOpen(!open)}
                aria-label={open ? "关闭目录" : "打开目录"}
                aria-expanded={open}
                className="flex w-full items-center justify-between px-5 h-11 text-sm font-medium text-gray-600"
            >
                <span className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
                    </svg>
                    目录
                    {activeId && (
                        <span className="ml-1 text-xs text-gray-400 truncate max-w-32">
                            / {items.find((i) => i.id === activeId)?.text}
                        </span>
                    )}
                </span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            {open && (
                <nav className="px-5 pb-4 bg-gray-50/80">
                    <TocList items={items} activeId={activeId} onSelect={onSelect}
                        onNavigate={() => setOpen(false)} />
                </nav>
            )}
        </div>
    )
}

export function TocDesktop({
    items,
    activeId,
    onSelect,
}: {
    items: TocItem[]
    activeId: string
    onSelect: (id: string) => void
}) {
    const containerRef = useRef<HTMLDivElement>(null)
    const prevId = useRef(activeId)

    useEffect(() => {
        if (!activeId || !containerRef.current || prevId.current === activeId) return
        prevId.current = activeId

        const link = containerRef.current.querySelector(`a[href="#${CSS.escape(activeId)}"]`) as HTMLElement | null
        if (!link) return

        const c = containerRef.current
        const cTop = c.getBoundingClientRect().top
        const lTop = link.getBoundingClientRect().top
        const lBottom = lTop + link.offsetHeight
        const EDGE = 8

        if (lTop < cTop + EDGE || lBottom > cTop + c.clientHeight - EDGE) {
            const linkTop = lTop - cTop + c.scrollTop
            const target = lTop < cTop + EDGE
                ? linkTop - EDGE
                : linkTop + link.offsetHeight + EDGE - c.clientHeight
            c.scrollTo({ top: target, behavior: "smooth" })
        }
    }, [activeId])

    if (items.length === 0) return null

    return (
        <div
            ref={containerRef}
            className="rounded-xl border border-gray-200/60 bg-gray-50/40 p-4 max-h-[calc(100vh-7rem)] overflow-y-auto"
        >
            <h4 className="mb-3 text-xs font-semibold text-gray-500 tracking-normal">
                目录
            </h4>
            <TocList items={items} activeId={activeId} onSelect={onSelect} />
        </div>
    )
}
