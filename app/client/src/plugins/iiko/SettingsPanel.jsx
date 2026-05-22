import PluginShell from '../PluginShell.jsx';
import { api } from '../../api.js';
import manifest from './manifest.js';

const CREDENTIAL_FIELDS = [
  { name: 'apiKey', label: 'API Key', type: 'password', required: true, hasSecretPlaceholder: true },
];

export default function IikoSettings(props) {
  return (
    <PluginShell
      manifest={manifest}
      api={api.iiko}
      credentialFields={CREDENTIAL_FIELDS}
      {...props}
    />
  );
}
