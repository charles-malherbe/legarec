import { mailboxData, type CaseDetail } from '@legarec/contracts';
import { EtatListe } from '@legarec/ui';
import layout from '@legarec/ui/layout.module.css';
import { useApi } from '../../app/data';
import { StaffMessageForm } from '../emails/StaffMessageForm';

/** Message written from the case file, sent from the employee's own OVH mailbox. */
export function CaseMessage({ data, onClose }: { data: CaseDetail; onClose: () => void }) {
  const mailbox = useApi(mailboxData, '/emails');
  if (!mailbox.data)
    return (
      <div className={layout.card}>
        <EtatListe kind={mailbox.error ? 'error' : 'loading'} compact onAction={() => void mailbox.refetch()} />
      </div>
    );
  const { email, name } = data.mainContact;
  return (
    <StaffMessageForm
      sender={mailbox.data.sender}
      templates={mailbox.data.templates}
      recipient={{ email, name, isDebtor: true, caseId: data.id, reference: data.reference }}
      onClose={onClose}
    />
  );
}
