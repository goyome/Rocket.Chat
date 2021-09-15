import { Meteor } from 'meteor/meteor';

import { settings } from '../../settings';

settings.onload('Force_SSL', function(key, value) {
	Meteor.absoluteUrl.defaultOptions.secure = value;
});
