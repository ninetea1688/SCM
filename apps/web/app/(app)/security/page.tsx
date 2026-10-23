import { TotpSetup } from './totp-setup';

/** AUTH-04: owners and admins must enable 2FA before using the workspace. */
export default function SecurityPage() {
  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">เปิดใช้การยืนยันตัวตน 2 ขั้น</h1>
      <p className="text-sm text-muted">
        บทบาทเจ้าของและแอดมินต้องเปิด 2FA ก่อนใช้งาน ใช้แอป Google Authenticator หรือ Microsoft
        Authenticator
      </p>
      <TotpSetup />
    </div>
  );
}
