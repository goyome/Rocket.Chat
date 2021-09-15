import { Permissions } from '../../models';

// TODO: Remove
if (!Permissions.findOne({ _id: 'auto-translate' })) {
	Permissions.insert({ _id: 'auto-translate', roles: ['admin'] });
}
