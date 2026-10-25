import type { Platform, ValidationIssue, VariantDraft, VariantStatus } from '@scm/domain';
import Link from 'next/link';
import { load } from '@/lib/load';
import { DiscussionSection } from './discussion';
import { TaxonomyChips, TaxonomyEditor } from './taxonomy-editor';
import { VariantCard } from './variant-card';

export interface VariantView {
  id: string;
  platform: Platform;
  socialAccountId: string;
  accountName: string;
  caption: string;
  mediaIds: string[];
  status: VariantStatus;
  version: number;
  approvedVersion: number | null;
  scheduledAt: string | null;
  permalink: string | null;
  issues: ValidationIssue[];
  options?: VariantDraft['options'];
}

interface PostView {
  id: string;
  title: string;
  body: string;
  taxonomy: {
    pillar?: string;
    topic?: string;
    audience?: string;
    format?: string;
    length?: string;
    hook?: string;
    cta?: string;
    aiUsed?: boolean;
    partnerShared?: boolean;
  };
  variants: VariantView[];
}

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await load<PostView>(`/posts/${id}`, `/posts/${id}`);
  // APPR-03: internal discussion (may be forbidden for viewer-only roles).
  const discussion = await load<{ id: string; author: string; text: string; createdAt: string }[]>(
    `/posts/${id}/comments`,
    `/posts/${id}`,
  ).catch(() => null);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/calendar" className="text-sm text-muted underline">
          กลับไปปฏิทิน
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{post.title}</h1>
      </div>
      <div className="space-y-4">
        {post.variants.map((v) => (
          <VariantCard key={v.id} variant={v} />
        ))}
      </div>
      <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
        <h2 className="font-medium">ป้ายคอนเทนต์ (POST-05)</h2>
        <TaxonomyChips t={post.taxonomy ?? {}} />
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm text-muted hover:text-ink">
            แก้ไขป้ายคอนเทนต์
          </summary>
          <div className="mt-2">
            <TaxonomyEditor postId={post.id} initial={post.taxonomy ?? {}} />
          </div>
        </details>
      </section>
      {discussion && <DiscussionSection postId={id} initial={discussion} />}
    </div>
  );
}
