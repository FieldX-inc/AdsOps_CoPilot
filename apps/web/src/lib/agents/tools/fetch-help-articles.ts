import { getHelpArticles } from "@/lib/store";
import type { HelpArticle } from "@/types/domain";

export async function fetchHelpArticlesByTags(tags: string[]): Promise<HelpArticle[]> {
  const uniqueTags = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
  return getHelpArticles(uniqueTags);
}
