import { uploadedFile } from '@legarec/contracts';
import { upload } from '@legarec/platform';

export const ACCEPTED = '.pdf,.png,.jpg,.jpeg';
/** Sends the files one by one; the API checks their content. */
export async function sendFiles(files: File[]) {
  const sent: { id: string; name: string }[] = [];
  for (const file of files) sent.push({ id: (await upload(uploadedFile, '/debtor/attachments', file)).id, name: file.name });
  return sent;
}
