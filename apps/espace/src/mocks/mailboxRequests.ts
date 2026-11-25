export type MailboxRequest = { id: string; holder: string; local: string; requestedBy: string };
let requests: MailboxRequest[] = [];
export const mailboxRequests = () => requests;
export const addMailboxRequest = (request: Omit<MailboxRequest, 'id'>) => {
  requests = [...requests, { ...request, id: crypto.randomUUID() }];
};
export const closeMailboxRequest = (id: string) => {
  requests = requests.filter((item) => item.id !== id);
};
export const resetMailboxRequests = () => {
  requests = [];
};
