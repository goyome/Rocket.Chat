import _ from 'underscore';

import { Migrations } from '../../../app/migrations';
import { upsertPermissions } from '../../../app/authorization/server/functions/upsertPermissions.js';

if (Migrations.getVersion() !== 0) {
	Migrations.migrateTo(process.env.MIGRATION_VERSION || 'latest');
} else {
	const control = Migrations._getControl();
	control.version = _.last(Migrations._list).version;
	Migrations._setControl(control);
	upsertPermissions();
}
