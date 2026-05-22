/*
 * Реестр плагинов клиента.
 *
 * Чтобы добавить новый плагин:
 *   1. Создать папку плагина: src/plugins/<id>/
 *   2. manifest.js — id, name, icon, description (см. quickresto/manifest.js)
 *   3. SettingsPanel.jsx — компонент настроек, принимает { venues, onClose, showToast }
 *   4. Добавить запись в массив PLUGINS ниже
 *   5. На сервере: подключить серверный модуль в server.js, добавить
 *      SETTINGS_TYPE в PLUGIN_SETTINGS_TYPES для фильтра /api/records
 *
 * Удаление плагина: убрать его из PLUGINS — UI скроется. Серверный
 * модуль убирается отдельно (см. server.js).
 */

import quickrestoManifest from './quickresto/manifest.js';
import QuickRestoSettings from './quickresto/SettingsPanel.jsx';
import iikoManifest       from './iiko/manifest.js';
import IikoSettings       from './iiko/SettingsPanel.jsx';

export const PLUGINS = [
  {
    ...quickrestoManifest,
    SettingsComponent: QuickRestoSettings,
  },
  {
    ...iikoManifest,
    SettingsComponent: IikoSettings,
  },
];
