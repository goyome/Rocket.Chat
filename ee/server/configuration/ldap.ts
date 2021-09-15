import { Meteor } from 'meteor/meteor';
import { Promise } from 'meteor/promise';
import _ from 'underscore';

import { LDAPEE } from '../sdk';
import { settings } from '../../../app/settings/server';
import { logger } from '../../../server/lib/ldap/Logger';
import { cronJobs } from '../../../app/utils/server/lib/cron/Cronjobs';
import { LDAPEEConnection } from '../lib/ldap/Connection';
import { LDAPEEManager } from '../lib/ldap/Manager';
import { callbacks } from '../../../app/callbacks/server';
import type { LDAPConnection } from '../../../server/lib/ldap/Connection';
import type { IImportUser } from '../../../app/importer/server/definitions/IImportUser';
import type { ILDAPEntry } from '../../../definition/ldap/ILDAPEntry';
import { onLicense } from '../../app/license/server';

onLicense('ldap-enterprise', () => {
	// Configure background sync cronjob
	const jobName = 'LDAP_Sync';
	const addCronJob = _.debounce(Meteor.bindEnvironment(function addCronJobDebounced() {
		if (settings.get('LDAP_Background_Sync') !== true) {
			logger.info('Disabling LDAP Background Sync');
			if (cronJobs.nextScheduledAtDate(jobName)) {
				cronJobs.remove(jobName);
			}
			return;
		}

		if (settings.get('LDAP_Background_Sync_Interval')) {
			logger.info('Enabling LDAP Background Sync');
			cronJobs.add(jobName, settings.getAs<string>('LDAP_Background_Sync_Interval'), () => Promise.await(LDAPEE.sync()), 'text');
		}
	}), 500);

	Meteor.startup(() => {
		Meteor.defer(() => {
			settings.get('LDAP_Background_Sync', addCronJob);
			settings.get('LDAP_Background_Sync_Interval', addCronJob);

			settings.get('LDAP_Groups_To_Rocket_Chat_Teams', (_key, value) => {
				try {
					LDAPEEManager.validateLDAPTeamsMappingChanges(value as string);
				} catch (error) {
					logger.error(error);
				}
			});
		});
	});

	callbacks.add('getLDAPConnectionClass', function(): typeof LDAPConnection {
		return LDAPEEConnection;
	}, callbacks.priority.HIGH, 'replaceLDAPConnectionClass');

	callbacks.add('mapLDAPUserData', (userData: IImportUser, ldapUser: ILDAPEntry) => {
		LDAPEEManager.copyCustomFields(ldapUser, userData);
		LDAPEEManager.copyActiveState(ldapUser, userData);
	}, callbacks.priority.MEDIUM, 'mapLDAPCustomFields');
});