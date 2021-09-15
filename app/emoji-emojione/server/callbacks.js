import emojione from 'emojione';

import { callbacks } from '../../callbacks';

callbacks.add('beforeSendMessageNotifications', (message) => emojione.shortnameToUnicode(message), callbacks.priority.MEDIUM, 'emojione-shortnameToUnicode');
