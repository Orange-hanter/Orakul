import PluginShell from '../PluginShell.jsx';
import { api } from '../../api.js';
import manifest from './manifest.js';

const CREDENTIAL_FIELDS = [
  { name: 'baseUrl',  label: 'Base URL', type: 'text',
    defaultValue: 'https://api.quickresto.ru/platform/online/api' },
  { name: 'username', label: 'Логин',    type: 'text',     required: true },
  { name: 'password', label: 'Пароль',   type: 'password', required: true, hasSecretPlaceholder: true },
];

export default function QuickRestoSettings(props) {
  return (
    <PluginShell
      manifest={manifest}
      api={api.quickresto}
      credentialFields={CREDENTIAL_FIELDS}
      {...props}
    />
  );
}
