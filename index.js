import debugModule from "debug";
import md5 from "crypto-js/md5.js";
import fetch from "isomorphic-fetch";

const debug = new debugModule("troi");

export class AuthenticationFailed extends Error {
  constructor() {
    super("Troi Authentication Failed");
    this.name = this.constructor.name;
  }
}

/**
 * Creates an instance of the TroiApiService.
 * @class
 */
export default class TroiApiService {
  /**
   * @constructor
   * @param {Object} initializationObject - An object to initialize the service
   * @param {string} initializationObject.baseUrl - The troi url for your company
   * @param {string} initializationObject.clientName - The clientName to get the company id for bookings
   * @param {string} initializationObject.username - The username to be used for all operations
   * @param {string} initializationObject.password - The users password to be used for all operations
   */
  constructor({ baseUrl, clientName, username, password }) {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.clientName = clientName;
    let passwordMd5 = md5(password);
    this.authHeader = {
      Authorization: "Basic " + btoa(`${username}:${passwordMd5}`),
    };
  }

  /**
   * @name initialize
   * @description initialization of the service
   */
  async initialize() {
    this.clientId = await this.getClientId();
    this.employeeId = await this.getEmployeeId();
  }

  /**
   *
   * @name getClientId
   * @description retrieve the id of the client for future operations
   * @returns {number} the clientId
   */
  async getClientId() {
    const client = await this.makeRequest({
      url: "/clients",
      predicate: (obj) => obj.Name === this.clientName,
    });
    return client.Id;
  }

  /**
   *
   * @name getEmployeeId
   * @description retrieve the id of the employee for future operations
   * @returns {number} the employeeId
   */
  async getEmployeeId() {
    return this.getEmployeeIdForUsername(this.username);
  }

  async getEmployeeIdForUsername(username) {
    const employees = await this.makeRequest({
      url: "/employees",
      params: {
        clientId: this.clientId,
        employeeLoginName: username,
      },
    });
    return employees[0] && employees[0].Id;
  }

  async getCalculationPositionsLastRecorded(employeeId) {
    let response = await this.makeRequest({
      url: "/billings/calculationPositionsLastRecorded",
      params: {
        clientId: this.clientId,
        employeeId: employeeId,
      },
    });
    if (!Array.isArray(response)) return false;
    return response;
  }

  async getCalculationPositions(favouritesOnly = true) {
    const calculationPositions = await this.makeRequest({
      url: "/calculationPositions",
      params: {
        clientId: this.clientId,
        favoritesOnly: `${favouritesOnly}`,
      },
    });
    return calculationPositions.map((obj) => {
      return {
        name: obj.DisplayPath,
        id: obj.Id,
      };
    });
  }

  async getTimeEntries(calculationPositionId, startDate, endDate) {
    return this.getTimeEntriesForEmployeeId(this.employeeId, calculationPositionId, startDate, endDate);
  }

  async getTimeEntriesForEmployeeId(employeeId, calculationPositionId, startDate, endDate) {
    const timeEntries = await this.makeRequest({
      url: "/billings/hours",
      params: {
        clientId: this.clientId,
        employeeId: employeeId,
        calculationPositionId: calculationPositionId,
        startDate: startDate,
        endDate: endDate,
      },
    });
    return timeEntries
        .map((obj) => {
          return {
            id: obj.id,
            date: obj.Date,
            hours: obj.Quantity,
            description: obj.Remark,
          };
        })
        .sort((a, b) => (a.date > b.date ? 1 : -1));
  }

  async postTimeEntry(calculationPositionId, date, hours, description) {
    const payload = {
      Client: {
        Path: `/clients/${this.clientId}`,
      },
      CalculationPosition: {
        Path: `/calculationPositions/${calculationPositionId}`,
      },
      Employee: {
        Path: `/employees/${this.employeeId}`,
      },
      Date: date,
      Quantity: hours,
      Remark: description,
    };

    await this.makeRequest({
      url: "/billings/hours",
      headers: { "Content-Type": "application/json" },
      method: "post",
      body: JSON.stringify(payload),
    });
  }

  async updateTimeEntry(
    calculationPositionId,
    date,
    hours,
    description,
    billingId
  ) {
    const payload = {
      Client: {
        Path: `/clients/${this.clientId}`,
      },
      CalculationPosition: {
        Path: `/calculationPositions/${calculationPositionId}`,
      },
      Employee: {
        Path: `/employees/${this.employeeId}`,
      },
      Date: date,
      Quantity: hours,
      Remark: description,
    };

    await this.makeRequest({
      url: `/billings/hours/${billingId}`,
      headers: { "Content-Type": "application/json" },
      method: "put",
      body: JSON.stringify(payload),
    });
  }

  async deleteTimeEntry(id) {
    return await this.makeRequest({
      url: `/billings/hours/${id}`,
      method: "delete",
    });
  }

  async deleteTimeEntryViaServerSideProxy(id) {
    return await fetch(`/time_entries/${id}`, {
      method: "delete",
      headers: {
        "X-Troi-Username": this.username,
        "X-Troi-Password": this.password,
      },
    });
  }

  async makeRequest(options) {
    const defaultOptions = {
      method: "get",
      params: undefined,
      headers: {},
      body: undefined,
    };
    options = { ...defaultOptions, ...options };
    const { url, method, params, headers, body } = options;

    const requestUrl = `${this.baseUrl}${url}${
      params ? `?${new URLSearchParams(params)}` : ""
    }`;
    const requestOptions = {
      method: method,
      headers: { ...this.authHeader, ...headers },
      body: body,
    };

    debug("Requesting", requestUrl, requestOptions);
    const response = await fetch(requestUrl, requestOptions);

    if ([401, 403].includes(response.status)) {
      throw new AuthenticationFailed();
    }

    const responseObjects = await response.json();

    if (!("predicate" in options)) {
      return responseObjects;
    }

    for (const responseObject of responseObjects) {
      if (options.predicate(responseObject)) {
        return responseObject;
      }
    }

    throw new Error("predicate provided, but no responseObject fulfills it");
  }
}
