import Link from "next/link"

export default function BlogLayout({
    children
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <div className="max-w-4xl mx-auto min-h-screen px-5 md:px-8 flex flex-col">
            <header className="py-8 md:py-12 flex flex-col md:flex-row gap-6 justify-between border-b border-gray-200">
                <Link href='/'>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-900">
                        Xiyao&apos;s Blog
                    </h1>
                </Link>
                <nav className="flex flex-row gap-5 items-center">
                    <Link href='/' className="text-base text-gray-500 hover:text-gray-900">
                        首页
                    </Link>
                    <Link href='/archives' className="text-base text-gray-500 hover:text-gray-900">
                        归档
                    </Link>
                </nav>
            </header>
            <main className="flex-1 py-10">
                { children }
            </main>
            <footer className="border-t border-gray-200 py-10" />
        </div>
    )
}