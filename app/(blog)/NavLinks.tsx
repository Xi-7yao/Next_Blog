"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const links = [
    { href: "/", label: "首页" },
    { href: "/archives", label: "归档" },
]

export default function NavLinks() {
    const pathname = usePathname()

    return (
        <nav className="flex flex-row gap-5 items-center">
            {links.map(({ href, label }) => {
                const isActive = pathname === href
                return (
                    <Link
                        key={href}
                        href={href}
                        className={`text-base transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded ${
                            isActive
                                ? "font-medium text-gray-900"
                                : "text-gray-500 hover:text-gray-900"
                        }`}
                    >
                        {label}
                    </Link>
                )
            })}
        </nav>
    )
}
