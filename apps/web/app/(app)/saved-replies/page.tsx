/** INBOX-05: manage standard answers used from the chat desk (create / edit / delete). */
import { load } from '@/lib/load';
import { SavedRepliesManager } from './saved-replies-manager';

interface SavedReply {
  id: string;
  title: string;
  body: string;
  shortcut: string | null;
}

export default async function SavedRepliesPage() {
  const replies = await load<SavedReply[]>('/saved-replies', '/saved-replies');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">คำตอบมาตรฐาน</h1>
        <p className="mt-1 text-sm text-muted">
          คำตอบที่ทีมใช้ซ้ำบ่อย — เรียกจากหน้าตอบแชทด้วยปุ่มด้านบนหรือพิมพ์ <code>/shortcut</code>
        </p>
      </div>
      <SavedRepliesManager initial={replies} />
    </div>
  );
}
