"use client"

import { useState, useCallback, useRef } from "react"

export default function PreWithCopy(props: React.ComponentProps<"pre">) {
    const [copied, setCopied] = useState(false)
    const preRef = useRef<HTMLPreElement>(null)

    const copy = useCallback(async () => {
        const code = preRef.current?.textContent ?? ""
        await navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 1000)
    }, [])

    return (
        <div className="group relative">
            <button
                className={`absolute right-3 top-3 rounded px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none ${
                    copied
                        ? "bg-green-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white"
                }`}
                onClick={copy}
            >
                {copied ? "已复制" : "复制"}
            </button>
            <pre ref={preRef} {...props} />
        </div>
    )
}
