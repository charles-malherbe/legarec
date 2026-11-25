import { FormulaireConnexion } from '@legarec/ui';
import { signedIn } from '@legarec/platform';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { SESSION_KEY } from '../../app/session';

export function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  return (
    <FormulaireConnexion
      onSession={(session) => {
        // Whoever was there before.
        client.clear();
        signedIn();
        if (session) client.setQueryData(SESSION_KEY, session);
        void navigate('/');
      }}
    />
  );
}
