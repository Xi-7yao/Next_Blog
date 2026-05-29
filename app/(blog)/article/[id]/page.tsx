import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import rehypeSlug from "rehype-slug"
import { getArticlesById, getAllArticleIds } from "@/app/lib/articles"
import TableOfContents from "./TableOfContents"
import PreWithCopy from "./PreWithCopy"

type Props = {
    params: Promise<{ id: string }>
}

export async function generateStaticParams() {
    const ids = await getAllArticleIds()
    return ids.map((id) => ({ id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params
    const article = await getArticlesById(id)

    if (!article) {
        return { title: "文章未找到" }
    }

    return {
        title: article.title,
        description: article.excerpt,
        openGraph: {
            title: article.title,
            description: article.excerpt,
            type: "article",
            publishedTime: article.date,
            tags: article.tags,
        },
    }
}

function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w一-鿿\s-]/g, "")
        .replace(/\s+/g, "-")
}

function extractTocItems(md: string) {
    const headings = md.match(/^#{2,3}\s+.+$/gm)
    if (!headings) return []
    return headings.map((h) => {
        const level = h.startsWith("### ") ? 3 : 2
        const text = h.replace(/^#{2,3}\s+/, "")
        return { id: slugify(text), text, level }
    })
}

export default async function ArticlePage({ params }: Props) {
    const { id } = await params
    const article = await getArticlesById(id)

    if (!article) {
        notFound()
    }

    const tocItems = extractTocItems(article.content)

    return (
        <div className="flex flex-row gap-10">
            <article className="min-w-0 flex-1">
                <header className="mb-10">
                    <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                        {article.title}
                    </h1>
                    <div className="flex flex-row flex-wrap gap-3 text-sm text-gray-500 items-center">
                        <time dateTime={article.date}>发布于 {article.date}</time>
                        <span>•</span>
                        <span>阅读 {article.readTime}</span>
                        <span>•</span>
                        <div className="flex flex-wrap gap-2">
                            {article.tags.map((tag) => (
                                <Link
                                    key={tag}
                                    href={`/?tag=${encodeURIComponent(tag)}`}
                                    className="text-gray-500 transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
                                >
                                    {tag}
                                </Link>
                            ))}
                        </div>
                    </div>
                </header>

                <div className="prose prose-gray max-w-none">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight, rehypeSlug]}
                        components={{
                            pre: PreWithCopy,
                        }}
                    >
                        {article.content}
                    </ReactMarkdown>
                </div>
            </article>
            <aside className="hidden lg:block w-56 shrink-0">
                <TableOfContents items={tocItems} />
            </aside>
        </div>
    )
}
