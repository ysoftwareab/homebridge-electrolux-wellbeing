"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const lodash_1 = __importDefault(require("lodash"));
const api_1 = require("./api");
const PLUGIN_NAME = 'electrolux-wellbeing';
const PLATFORM_NAME = 'ElectroluxWellbeing';
// Pure A9 fans support speeds from [1, 9].
const FAN_SPEED_MULTIPLIER = 100 / 9;
let hap, Service, Characteristic;
let Accessory;
class ElectroluxWellbeingPlatform {
    constructor(log, config, api) {
        this.accessories = [];
        this.log = log;
        this.api = api;
        this.config = config;
        api.on("didFinishLaunching" /* DID_FINISH_LAUNCHING */, async () => {
            if (this.needsConfiguration()) {
                this.log('Please configure this plugin first.');
                return;
            }
            //this.removeAccessories();
            try {
                this.client = await api_1.createClient({
                    username: this.config.username,
                    password: this.config.password,
                });
            }
            catch (err) {
                this.log.debug('Error while creating client', err);
                return;
            }
            const appliances = await this.getAllAppliances();
            const applianceData = await Promise.all(appliances.map((appliance) => this.fetchApplianceData(appliance.pncId)));
            this.log.debug('Fetched: ', applianceData);
            appliances.map(({ applianceName, modelName, pncId }, i) => {
                var _a;
                this.addAccessory({
                    pncId,
                    name: applianceName,
                    modelName,
                    firmwareVersion: (_a = applianceData[i]) === null || _a === void 0 ? void 0 : _a.firmwareVersion,
                });
            });
            this.updateValues(applianceData);
            setInterval(() => this.checkAppliances(), this.getPollTime(this.config.pollTime));
        });
    }
    needsConfiguration() {
        return !this.config.username || !this.config.password;
    }
    getPollTime(pollTime) {
        if (!pollTime || pollTime < 5) {
            this.log.info('Set poll time is below 5s, forcing 5s');
            return 5 * 1000;
        }
        this.log.debug(`Refreshing every ${pollTime}s`);
        return pollTime * 1000;
    }
    async checkAppliances() {
        const data = await this.fetchAppliancesData();
        this.log.debug('Fetched: ', data);
        this.updateValues(data);
    }
    async fetchAppliancesData() {
        return await Promise.all(this.accessories.map((accessory) => this.fetchApplianceData(accessory.context.pncId)));
    }
    async fetchApplianceData(pncId) {
        try {
            const response = await this.client.get(`/Appliances/${pncId}`);
            const reported = response.data.twin.properties.reported;
            return {
                pncId,
                name: response.data.applianceData.applianceName,
                modelName: response.data.applianceData.modelName,
                firmwareVersion: reported.FrmVer_NIU,
                workMode: reported.Workmode,
                filterRFID: reported.FilterRFID,
                filterLife: reported.FilterLife,
                fanSpeed: reported.Fanspeed,
                UILight: reported.UILight,
                safetyLock: reported.SafetyLock,
                ionizer: reported.Ionizer,
                sleep: reported.Sleep,
                scheduler: reported.Scheduler,
                filterType: reported.FilterType,
                version: reported['$version'],
                pm1: reported.PM1,
                pm25: reported.PM2_5,
                pm10: reported.PM10,
                tvoc: reported.TVOC,
                co2: reported.CO2,
                temp: reported.Temp,
                humidity: reported.Humidity,
                envLightLevel: reported.EnvLightLvl,
                rssi: reported.RSSI,
            };
        }
        catch (err) {
            this.log.info('Could not fetch appliances data: ' + err);
        }
    }
    async getAllAppliances() {
        try {
            const response = await this.client.get('/Domains/Appliances');
            return response.data;
        }
        catch (err) {
            this.log.info('Could not fetch appliances: ' + err);
            return [];
        }
    }
    async sendCommand(pncId, command, value) {
        this.log.debug('sending command', {
            [command]: value,
        });
        try {
            const response = await this.client.put(`/Appliances/${pncId}/Commands`, {
                [command]: value,
            });
            this.log.debug('command responded', response.data);
        }
        catch (err) {
            this.log.info('Could run command', err);
        }
    }
    updateValues(data) {
        this.accessories.map((accessory) => {
            const { pncId } = accessory.context;
            const state = this.getApplianceState(pncId, data);
            // Guard against missing data due to API request failure.
            if (!state) {
                return;
            }
            // Keep firmware revision up-to-date in case the device is updated.
            accessory
                .getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.FirmwareRevision, state.firmwareVersion);
            accessory
                .getService(Service.TemperatureSensor)
                .updateCharacteristic(Characteristic.CurrentTemperature, state.temp);
            accessory
                .getService(Service.HumiditySensor)
                .updateCharacteristic(Characteristic.CurrentRelativeHumidity, state.humidity);
            accessory
                .getService(Service.CarbonDioxideSensor)
                .updateCharacteristic(Characteristic.CarbonDioxideLevel, state.co2);
            if (state.envLightLevel) {
                // Env Light Level needs to be tested with lux meter
                accessory
                    .getService(Service.LightSensor)
                    .updateCharacteristic(Characteristic.CurrentAmbientLightLevel, state.envLightLevel);
            }
            accessory
                .getService(Service.AirQualitySensor)
                .updateCharacteristic(Characteristic.AirQuality, this.getAirQualityLevel(state.pm25))
                .updateCharacteristic(Characteristic.PM2_5Density, state.pm25)
                .updateCharacteristic(Characteristic.PM10Density, state.pm10)
                .updateCharacteristic(Characteristic.VOCDensity, this.convertTVOCToDensity(state.tvoc));
            accessory
                .getService(Service.AirPurifier)
                .updateCharacteristic(Characteristic.FilterLifeLevel, state.filterLife)
                .updateCharacteristic(Characteristic.FilterChangeIndication, state.filterLife < 10
                ? Characteristic.FilterChangeIndication.CHANGE_FILTER
                : Characteristic.FilterChangeIndication.FILTER_OK)
                .updateCharacteristic(Characteristic.Active, state.workMode !== "PowerOff" /* Off */)
                .updateCharacteristic(Characteristic.CurrentAirPurifierState, this.getAirPurifierState(state.workMode))
                .updateCharacteristic(Characteristic.TargetAirPurifierState, this.getAirPurifierStateTarget(state.workMode))
                .updateCharacteristic(Characteristic.RotationSpeed, state.fanSpeed * FAN_SPEED_MULTIPLIER)
                .updateCharacteristic(Characteristic.LockPhysicalControls, state.safetyLock)
                .updateCharacteristic(Characteristic.SwingMode, state.ionizer);
        });
    }
    getApplianceState(pncId, data) {
        return lodash_1.default.find(data, { pncId });
    }
    configureAccessory(accessory) {
        this.log('Configuring accessory %s', accessory.displayName);
        const { pncId } = accessory.context;
        accessory.on("identify" /* IDENTIFY */, () => {
            this.log('%s identified!', accessory.displayName);
        });
        accessory
            .getService(Service.AirPurifier)
            .getCharacteristic(Characteristic.Active)
            .on("set" /* SET */, (value, callback) => {
            const workMode = value === 1 ? "Auto" /* Auto */ : "PowerOff" /* Off */;
            if (accessory
                .getService(Service.AirPurifier)
                .getCharacteristic(Characteristic.Active).value !== value) {
                this.sendCommand(pncId, 'WorkMode', workMode);
                this.log.info('%s AirPurifier Active was set to: ' + workMode, accessory.displayName);
            }
            callback();
        });
        accessory
            .getService(Service.AirPurifier)
            .getCharacteristic(Characteristic.TargetAirPurifierState)
            .on("set" /* SET */, (value, callback) => {
            const workMode = value === Characteristic.TargetAirPurifierState.MANUAL
                ? "Manual" /* Manual */
                : "Auto" /* Auto */;
            this.sendCommand(pncId, 'WorkMode', workMode);
            this.log.info('%s AirPurifier Work Mode was set to: ' + workMode, accessory.displayName);
            callback();
        });
        accessory
            .getService(Service.AirPurifier)
            .getCharacteristic(Characteristic.RotationSpeed)
            .on("set" /* SET */, (value, callback) => {
            const fanSpeed = Math.floor(parseInt(value.toString()) / FAN_SPEED_MULTIPLIER);
            this.sendCommand(pncId, 'FanSpeed', fanSpeed);
            this.log.info('%s AirPurifier Fan Speed set to: ' + fanSpeed, accessory.displayName);
            callback();
        });
        accessory
            .getService(Service.AirPurifier)
            .getCharacteristic(Characteristic.LockPhysicalControls)
            .on("set" /* SET */, (value, callback) => {
            if (accessory
                .getService(Service.AirPurifier)
                .getCharacteristic(Characteristic.LockPhysicalControls).value !==
                value) {
                this.sendCommand(pncId, 'SafetyLock', value);
                this.log.info('%s AirPurifier Saftey Lock set to: ' + value, accessory.displayName);
            }
            callback();
        });
        accessory
            .getService(Service.AirPurifier)
            .getCharacteristic(Characteristic.SwingMode)
            .on("set" /* SET */, (value, callback) => {
            if (accessory
                .getService(Service.AirPurifier)
                .getCharacteristic(Characteristic.SwingMode).value !== value) {
                this.sendCommand(pncId, 'Ionizer', value);
                this.log.info('%s AirPurifier Ionizer set to: ' + value, accessory.displayName);
            }
            callback();
        });
        this.accessories.push(accessory);
    }
    addAccessory({ name, modelName, pncId, firmwareVersion }) {
        const uuid = hap.uuid.generate(pncId);
        if (!this.isAccessoryRegistered(name, uuid)) {
            this.log.info('Adding new accessory with name %s', name);
            const accessory = new Accessory(name, uuid);
            accessory.context.pncId = pncId;
            accessory.addService(Service.AirPurifier);
            accessory.addService(Service.AirQualitySensor);
            accessory.addService(Service.TemperatureSensor);
            accessory.addService(Service.CarbonDioxideSensor);
            accessory.addService(Service.HumiditySensor);
            accessory.addService(Service.LightSensor);
            accessory
                .getService(Service.AccessoryInformation)
                .setCharacteristic(Characteristic.Manufacturer, 'Electrolux')
                .setCharacteristic(Characteristic.Model, modelName)
                .setCharacteristic(Characteristic.SerialNumber, pncId)
                .setCharacteristic(Characteristic.FirmwareRevision, firmwareVersion);
            this.configureAccessory(accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
                accessory,
            ]);
        }
        else {
            this.log.info('Accessory name %s already added, loading from cache ', name);
        }
    }
    removeAccessories() {
        this.log.info('Removing all accessories');
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
        this.accessories.splice(0, this.accessories.length);
    }
    isAccessoryRegistered(name, uuid) {
        return !!lodash_1.default.find(this.accessories, { UUID: uuid });
    }
    getAirQualityLevel(pm25) {
        switch (true) {
            case pm25 < 6:
                return Characteristic.AirQuality.EXCELLENT;
            case pm25 < 12:
                return Characteristic.AirQuality.GOOD;
            case pm25 < 36:
                return Characteristic.AirQuality.FAIR;
            case pm25 < 50:
                return Characteristic.AirQuality.INFERIOR;
            case pm25 >= 50:
                return Characteristic.AirQuality.POOR;
        }
        return Characteristic.AirQuality.UNKNOWN;
    }
    getAirPurifierState(workMode) {
        if (workMode !== "PowerOff" /* Off */) {
            return Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
        }
        return Characteristic.CurrentAirPurifierState.INACTIVE;
    }
    getAirPurifierStateTarget(workMode) {
        if (workMode === "Auto" /* Auto */) {
            return Characteristic.TargetAirPurifierState.AUTO;
        }
        return Characteristic.TargetAirPurifierState.MANUAL;
    }
    // Best effort attempt to convert Wellbeing TVOC ppb reading to μg/m3, but we lack insight into their algorithms
    // or TVOC densities. We assume 1 ppb = 3.243 μg/m3 (see benzene @ 20C [1]) as this produces results (μg/m3) that fit
    // quite well within the defined ranges in [2].
    //
    // Wellbeing defines 1500 ppb as possibly having an effect on health when exposed to these levels for a month, [2]
    // lists 400-500 μg/m3 as _marginal_ which sounds like a close approximation. Here's an example where 1500 ppb falls
    // within the _marginal_ range.
    //
    //   1500 * 3.243 / 10 = 486.45
    //
    // Note: It's uncertain why we have to divide the result by 10 for the values to make sense, perhaps this is a
    // Wellbeing quirk, but at least the values look good.
    //
    // The maximum value shown by Wellbeing is 4000 ppb and the maximum value accepted by HomeKit is 1000 μg/m3, our
    // assumed molecular density may put the value outside of the HomeKit range, but not by much, which seems acceptable:
    //
    //  4000 * 3.243 / 10 = 1297.2
    //
    // [1] https://uk-air.defra.gov.uk/assets/documents/reports/cat06/0502160851_Conversion_Factors_Between_ppb_and.pdf
    // [2] https://myhealthyhome.info/assets/pdfs/TB531rev2TVOCInterpretation.pdf
    convertTVOCToDensity(tvocppb) {
        const ugm3 = (tvocppb * 3.243) / 10;
        return Math.min(ugm3, 1000);
    }
}
module.exports = (api) => {
    hap = api.hap;
    Accessory = api.platformAccessory;
    Service = hap.Service;
    Characteristic = hap.Characteristic;
    api.registerPlatform(PLATFORM_NAME, ElectroluxWellbeingPlatform);
};
//# sourceMappingURL=index.js.map