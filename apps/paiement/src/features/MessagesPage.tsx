import { ATTACHMENT_KINDS, debtorMessage, debtorMessages } from '@legarec/contracts';
import { Alerte, Bouton, Champ, DepotFichiers, EtatListe, FilMessages, useConfirm, useToast } from '@legarec/ui';
import { useEffect, useState } from 'react';
import css from '../app/Debtor.module.css';
import { useApi, useChange } from '../app/data';
import { useCase } from '../app/Space';
import { ACCEPTED, sendFiles } from './uploads';

export function MessagesPage() {
  const item = useCase();
  const path = `/debtor/cases/${item.id}/messages`;
  const { data, error, refetch } = useApi(debtorMessages, path);
  const change = useChange();
  const confirm = useConfirm();
  const toast = useToast();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<keyof typeof ATTACHMENT_KINDS>('TRANSFER_PROOF');
  const [files, setFiles] = useState<File[]>([]);
  const [problem, setProblem] = useState('');
  const unread = item.unread > 0;
  useEffect(() => {
    if (unread) void change(`${path}/read`);
    // Marks the thread as read once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unread, path]);
  const submit = () => {
    const parsed = debtorMessage.safeParse({ text, attachmentKind: kind, attachments: [] });
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? '');
    setProblem('');
    confirm({
      title: 'Envoyer ce message au cabinet ?',
      body: parsed.data.text,
      details: [
        { k: 'Dossier', v: item.reference },
        ...(files.length > 0 ? [{ k: ATTACHMENT_KINDS[kind], v: files.map((file) => file.name).join(', ') }] : []),
      ],
      confirmLabel: 'Envoyer le message',
      onConfirm: async () => {
        await change(path, { body: { ...parsed.data, attachments: await sendFiles(files) } });
        setText('');
        setFiles([]);
        toast({ message: 'Message envoyé. Nous en accusons réception.' });
      },
    });
  };
  return (
    <section aria-labelledby="fil-titre" className={css.panel}>
      <h2 id="fil-titre">Vos échanges avec le cabinet</h2>
      {!data ? (
        <EtatListe kind={error ? 'error' : 'loading'} onAction={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EtatListe kind="empty" title="Aucun message" text="Écrivez-nous : votre gestionnaire vous répond sous un jour ouvré." />
      ) : (
        <FilMessages label="Vos échanges avec le cabinet" messages={data.items.map((entry) => ({ ...entry, receipt: entry.receipt ?? undefined }))} />
      )}
      <form
        className={css.stack}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Champ label="Votre message" type="textarea" rows={4} value={text} error={problem} onChange={setText} />
        <DepotFichiers
          label="Ajouter une pièce"
          hint="Justificatif de virement, copie de chèque, contestation, attestation… PDF ou image, 10 Mo max."
          accept={ACCEPTED}
          multiple
          files={files}
          onChange={setFiles}
        />
        {files.length > 0 && (
          <Champ
            label="Type de pièce"
            type="select"
            value={kind}
            options={Object.entries(ATTACHMENT_KINDS).map(([value, label]) => ({ value, label }))}
            onChange={(value) => setKind(value as keyof typeof ATTACHMENT_KINDS)}
          />
        )}
        <Alerte tone="info" compact text="N’envoyez jamais vos coordonnées bancaires ni de pièce d’identité par ce message." />
        <div className={css.inline}>
          <Bouton type="submit" label="Envoyer" />
        </div>
      </form>
    </section>
  );
}
