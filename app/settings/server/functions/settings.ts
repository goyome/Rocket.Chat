import { Emitter } from '@rocket.chat/emitter';
import { Meteor } from 'meteor/meteor';
import _ from 'underscore';

import { SettingsBase } from '../../lib/settings';
import SettingsModel from '../../../models/server/models/Settings';
import { updateValue } from '../raw';
import { ISetting, ISettingColor, ISettingGroup, isSettingColor, isSettingEnterprise, SettingValue } from '../../../../definition/ISetting';
import { SystemLogger } from '../../../../server/lib/logger/system';

const blockedSettings = new Set<string>();
const hiddenSettings = new Set<string>();
const wizardRequiredSettings = new Set<string>();

if (process.env.SETTINGS_BLOCKED) {
	process.env.SETTINGS_BLOCKED.split(',').forEach((settingId) => blockedSettings.add(settingId.trim()));
}

if (process.env.SETTINGS_HIDDEN) {
	process.env.SETTINGS_HIDDEN.split(',').forEach((settingId) => hiddenSettings.add(settingId.trim()));
}

if (process.env.SETTINGS_REQUIRED_ON_WIZARD) {
	process.env.SETTINGS_REQUIRED_ON_WIZARD.split(',').forEach((settingId) => wizardRequiredSettings.add(settingId.trim()));
}

export const SettingsEvents = new Emitter();

const convertValue = (value: 'true' | 'false' | string, type: ISetting['type']): SettingValue => {
	if (value.toLowerCase() === 'true') {
		return true;
	}
	if (value.toLowerCase() === 'false') {
		return false;
	}
	if (type === 'int') {
		return parseInt(value);
	}
	return value;
};


const overrideSetting = (setting: ISetting): ISetting => {
	const overwriteValue = process.env[setting._id];
	if (!overwriteValue) {
		return setting;
	}

	const value = convertValue(overwriteValue, setting.type);

	if (value === setting.value) {
		return setting;
	}

	return {
		...setting,
		value,
		processEnvValue: value,
		valueSource: 'processEnvValue',
	};
};

const overwriteSetting = (setting: ISetting): ISetting => {
	const overwriteValue = process.env[`OVERWRITE_SETTING_${ setting._id }`];
	if (!overwriteValue) {
		return setting;
	}

	const value = convertValue(overwriteValue, setting.type);

	if (value === setting.value) {
		return setting;
	}

	SystemLogger.log(`Overwriting setting ${ setting._id }`);

	return {
		...setting,
		value,
		processEnvValue: value,
		// blocked: true, TODO: add this back
		valueSource: 'processEnvValue',
	};
};

const getGroupDefaults = (_id: string, options: ISettingAddGroupOptions = {}): ISettingGroup => ({
	_id,
	i18nLabel: _id,
	i18nDescription: `${ _id }_Description`,
	...options,
	blocked: blockedSettings.has(_id),
	hidden: hiddenSettings.has(_id),
	type: 'group',
});

export type ISettingAddGroupOptions = Partial<ISettingGroup>;



// interface IUpdateOperator {
// 	$set: ISettingAddOptions;
// 	$setOnInsert: ISettingAddOptions & {
// 		createdAt: Date;
// 	};
// 	$unset?: {
// 		section?: 1;
// 	};
// }

type QueryExpression = {
	$exists: boolean;
}

type Query<T> = {
	[P in keyof T]?: T[P] | QueryExpression;
}

type addSectionCallback = (this: {
	add(id: string, value: SettingValue, options: ISettingAddOptions): void;
}) => void;

type addGroupCallback = (this: {
	add(id: string, value: SettingValue, options: ISettingAddOptions): void;
	section(section: string, cb: addSectionCallback): void;
}) => void;

const getSettingDefaults = (setting: Partial<ISetting> & Pick<ISetting, '_id' | 'value' | 'type'>): ISetting => {
	const { _id, value, sorter, ...options } = setting;
	return {
		_id,
		value,
		packageValue: value,
		valueSource: 'packageValue',
		secret: false,
		enterprise: false,
		i18nDescription: `${ _id }_Description`,
		autocomplete: true,
		...sorter && { sorter },
		...options.enableQuery && { enableQuery: JSON.stringify(options.enableQuery) },
		...options,
		i18nLabel: options.i18nLabel || _id,
		hidden: options.hidden || hiddenSettings.has(_id),
		blocked: options.blocked || blockedSettings.has(_id),
		requiredOnWizard: options.requiredOnWizard || wizardRequiredSettings.has(_id),
		type: options.type || 'string',
		env: options.env || false,
		public: options.public || false,
		...isSettingColor(setting as ISetting) && {
			packageEditor: (setting as ISettingColor).editor,
		},
	};
};

type ISettingAddOptions = Partial<ISetting>;
class Settings extends SettingsBase {
	private _sorter: {[key: string]: number} = {};

	private initialLoad = true;

	/*
	* Add a setting
	*/
	add(_id: string, value: SettingValue, { sorter, group, ...options }: ISettingAddOptions = {}): void {
		if (!_id || value == null) {
			throw new Error('Invalid arguments');
		}

		if (group) {
			this._sorter[group] = this._sorter[group] || -1;
			this._sorter[group]++;
		}

		const settingFromCode = getSettingDefaults({ _id, type: 'string', value, sorter, group, ...options });

		if (isSettingEnterprise(settingFromCode) && !('invalidValue' in settingFromCode)) {
			SystemLogger.error(`Enterprise setting ${ _id } is missing the invalidValue option`);
			throw new Error(`Enterprise setting ${ _id } is missing the invalidValue option`);
		}

		const settingStoredValue = Meteor.settings[_id] as ISetting['value'] | undefined;
		const settingOverwritten = overwriteSetting(settingFromCode);

		const isOverwritten = settingFromCode !== settingOverwritten;

		if (isOverwritten) {
			const { _id: _, ...settingProps } = settingOverwritten;
			settingStoredValue !== settingOverwritten.value && SettingsModel.upsert({ _id }, settingProps);
			return;
		}

		if (settingStoredValue !== undefined) {
			return;
		}

		const settingOverwrittenDefault = overrideSetting(settingFromCode);

		const setting = isOverwritten ? settingOverwritten : settingOverwrittenDefault;

		SettingsModel.insert(setting); // no need to emit unless we remove the oplog
	}

	/*
	* Add a setting group
	*/
	addGroup(_id: string, cb: addGroupCallback): void;

	// eslint-disable-next-line no-dupe-class-members
	addGroup(_id: string, grupOptions: ISettingAddGroupOptions | addGroupCallback = {}, cb?: addGroupCallback): void {
		if (!_id || (grupOptions instanceof Function && cb)) {
			throw new Error('Invalid arguments');
		}

		const callback = grupOptions instanceof Function ? grupOptions : cb;

		const options = grupOptions instanceof Function ? getGroupDefaults(_id) : getGroupDefaults(_id, grupOptions);

		const existentGroup = Meteor.settings[_id];

		if (existentGroup === undefined) {
			options.ts = new Date();
			SettingsModel.upsert({
				_id,
			}, {
				$set: options,
				$setOnInsert: {
					createdAt: new Date(),
				},
			});
		}

		if (!callback) {
			return;
		}
		callback.call({
			add: (id: string, value: SettingValue, options: ISettingAddOptions = {}) => {
				options.group = _id;
				return this.add(id, value, options);
			},
			section: (section: string, cb: addSectionCallback) => cb.call({
				add: (id: string, value: SettingValue, options: ISettingAddOptions = {}) => {
					options.group = _id;
					options.section = section;
					return this.add(id, value, options);
				},
			}),
		});
	}

	/*
	* Remove a setting by id
	*/
	removeById(_id: string): boolean {
		if (!_id) {
			return false;
		}
		return SettingsModel.removeById(_id);
	}

	/*
	* Update a setting by id
	*/
	updateById(_id: string, value: SettingValue, editor?: string): boolean {
		if (!_id || value == null) {
			return false;
		}
		if (editor != null) {
			return SettingsModel.updateValueAndEditorById(_id, value, editor);
		}
		return SettingsModel.updateValueById(_id, value);
	}

	/*
	* Update options of a setting by id
	*/
	updateOptionsById(_id: string, options: ISettingAddOptions): boolean {
		if (!_id || options == null) {
			return false;
		}

		return SettingsModel.updateOptionsById(_id, options);
	}

	/*
	* Update a setting by id
	*/
	clearById(_id: string): boolean {
		if (_id == null) {
			return false;
		}
		return SettingsModel.updateValueById(_id, undefined);
	}

	/*
	* Change a setting value on the Meteor.settings object
	*/
	storeSettingValue(record: ISetting, initialLoad: boolean): void {
		const newData = {
			value: record.value,
		};
		SettingsEvents.emit('store-setting-value', record, newData);
		const { value } = newData;

		Meteor.settings[record._id] = value;
		if (record.env === true) {
			process.env[record._id] = String(value);
		}

		this.load(record._id, value, initialLoad);
	}

	/*
	* Remove a setting value on the Meteor.settings object
	*/
	removeSettingValue(record: ISetting, initialLoad: boolean): void {
		SettingsEvents.emit('remove-setting-value', record);

		delete Meteor.settings[record._id];
		if (record.env === true) {
			delete process.env[record._id];
		}

		this.load(record._id, undefined, initialLoad);
	}

	init(): void {
		SettingsModel.find().forEach((record: ISetting) => {
			this.storeSettingValue(record, true);
			updateValue(record._id, { value: record.value });
		});
		this.initialLoad = false;
		SettingsEvents.emit('after-initial-load', Meteor.settings);
	}

	onAfterInitialLoad(fn: (settings: Meteor.Settings) => void): void {
		if (this.initialLoad === false) {
			return fn(Meteor.settings);
		}
		SettingsEvents.once('after-initial-load', fn);
	}
}

export const settings = new Settings();
settings.init();
