import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import matter from "gray-matter";
import GithubSlugger from "github-slugger";

export interface ArticleSeries {
    name: string;
    order: number;
}

export interface Article {
    id: string;
    title: string;
    excerpt: string;
    date: string;
    tags: string[];
    readTime: string;
    series?: ArticleSeries;
    status: "published" | "draft";
}

export interface ArticlesDetail extends Article {
    content: string;
}

const articlesDir = join(process.cwd(), "content", "articles");

interface ParsedPost {
    slug: string;
    title: string;
    date: string;
    tags: string[];
    readTime: string;
    series?: ArticleSeries;
    status: "published" | "draft";
    excerpt: string;
    content: string;
}

function extractExcerpt(md: string, maxLength = 260): string {
    const plainText = md
        .replace(/```[\s\S]*?```/g, "")       // 删除代码块
        .replace(/`[^`]+`/g, "")              // 删除行内代码
        .replace(/!\[.*?\]\(.*?\)/g, "")      // 删除图片（必须在去除 [] 之前）
        .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // 链接保留文本（必须在去除 [] 之前）
        .replace(/^#{1,6}\s+/gm, "")          // 去掉标题 #
        .replace(/^>\s+/gm, "")               // 去掉引用 >
        .replace(/[#|]/g, "")                 // 去掉表格分隔符和残留 #
        .replace(/\s+/g, " ")
        .trim();

    if (plainText.length <= maxLength) return plainText;
    return plainText.slice(0, maxLength).trimEnd() + "...";
}

function parsePosts(): ParsedPost[] {
    const files = readdirSync(articlesDir).filter((f) => f.endsWith(".md"));

    const posts = files.map((file) => {
        const raw = readFileSync(join(articlesDir, file), "utf-8");
        const { data, content: mdContent } = matter(raw);

        const excerpt =
            typeof data.excerpt === "string" && data.excerpt.trim()
                ? data.excerpt
                : extractExcerpt(mdContent);

        const rawDate = data.date instanceof Date
            ? data.date.toISOString().split("T")[0]
            : String(data.date ?? "");

        const series =
            data.series &&
            typeof data.series === "object" &&
            typeof data.series.name === "string" &&
            typeof data.series.order === "number"
                ? { name: data.series.name, order: data.series.order }
                : undefined;

        const post: ParsedPost = {
            slug: String(data.slug ?? ""),
            title: String(data.title ?? ""),
            date: rawDate,
            tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
            readTime: String(data.readTime ?? ""),
            series,
            status: data.status === "published" ? "published" : "draft",
            excerpt,
            content: mdContent,
        };
        return post;
    });

    return posts.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
}

function mapPostToArticle(post: ParsedPost): Article {
    return {
        id: post.slug,
        title: post.title,
        excerpt: post.excerpt,
        date: post.date,
        tags: post.tags,
        readTime: post.readTime,
        ...(post.series ? { series: post.series } : {}),
        status: post.status,
    };
}

const posts = parsePosts();

export async function getArticles(): Promise<Article[]> {
    return posts
        .filter((p) => p.status === "published")
        .map(mapPostToArticle);
}

export async function getArticlesById(id: string): Promise<ArticlesDetail | null> {
    const post = posts.find((p) => p.slug === id && p.status === "published");
    if (!post) return null;

    return {
        ...mapPostToArticle(post),
        content: post.content,
    };
}

export async function getAllArticleIds(): Promise<string[]> {
    return posts.filter((p) => p.status === "published").map((p) => p.slug);
}

export async function getSeriesList(): Promise<{ name: string; articles: Article[] }[]> {
    const published = posts.filter((p) => p.status === "published" && p.series);
    const map = new Map<string, Article[]>();
    for (const p of published) {
        const name = p.series!.name;
        if (!map.has(name)) map.set(name, []);
        map.get(name)!.push(mapPostToArticle(p));
    }
    for (const articles of map.values()) {
        articles.sort((a, b) => a.series!.order - b.series!.order);
    }
    // 按系列中最新文章日期排序
    return Array.from(map.entries())
        .map(([name, articles]) => ({ name, articles }))
        .sort((a, b) => {
            const latestA = Math.max(...a.articles.map((x) => new Date(x.date).getTime()));
            const latestB = Math.max(...b.articles.map((x) => new Date(x.date).getTime()));
            return latestB - latestA;
        });
}

export async function getStandaloneArticles(): Promise<Article[]> {
    return posts
        .filter((p) => p.status === "published" && !p.series)
        .map(mapPostToArticle);
}

export async function getSeriesArticles(name: string): Promise<Article[]> {
    return posts
        .filter((p) => p.status === "published" && p.series?.name === name)
        .map(mapPostToArticle)
        .sort((a, b) => a.series!.order - b.series!.order);
}

export interface TocItem {
    id: string;
    text: string;
    level: number;
}

export function extractTocItems(content: string): TocItem[] {
    // 先移除代码块，避免匹配到代码注释中的 # 行
    const withoutCodeBlocks = content.replace(/```[\s\S]*?```/g, "");
    const matches = withoutCodeBlocks.match(/^#{1,2}\s+.+$/gm);
    if (!matches) return [];

    const slugger = new GithubSlugger();
    return matches.map((line) => {
        const level = line.startsWith("## ") ? 2 : 1;
        const text = line.replace(/^#{1,2}\s+/, "");
        return { id: slugger.slug(text), text, level };
    });
}
