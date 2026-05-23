import { notFound } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { getArticlesById, getAllArticleIds } from "@/app/lib/articles"

type Props = {
    params: Promise<{ id: string }>
}

export async function generateStaticParams() {
    const ids = await getAllArticleIds()
    return ids.map((id) => ({ id }))
}

export default async function ArticlePage({ params }: Props) {
    const { id } = await params
    const article = await getArticlesById(id)

    if (!article) {
        notFound()
    }

    return (
        <article>
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
                            <span key={tag} className="text-gray-500">
                                {tag}
                            </span>
                        ))}
                    </div>
                </div>
            </header>

            <div className="prose prose-gray max-w-none">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                >
                    {article.content}
                </ReactMarkdown>
            </div>
        </article>
    )
}
