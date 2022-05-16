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

export default class TroiApiService {
  constructor(baseUrl, userName, password) {
    this.baseUrl = baseUrl;
    this.userName = userName;
    this.password = password;
    let passwordMd5 = md5(password);
    this.authHeader = {
      Authorization: "Basic " + btoa(`${userName}:${passwordMd5}`),
    };
  }

  async initialize() {
    this.clientId = await this.getClientId();
    this.employeeId = await this.getEmployeeId();
  }

  async getClientId() {
    const client = await this.makeRequest({
      url: "/clients",
      predicate: (obj) => obj.Name === "DigitalService4Germany GmbH",
    });
    return client.Id;
  }

  async getEmployeeId() {
    const employees = await this.makeRequest({
      url: "/employees",
      params: {
        clientId: this.clientId,
        employeeLoginName: this.userName,
      },
    });
    return employees[0].Id;
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
    const timeEntries = await this.makeRequest({
      url: "/billings/hours",
      params: {
        clientId: this.clientId,
        employeeId: this.employeeId,
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

  async deleteTimeEntry(id) {
    await this.makeRequest({
      url: `/billings/hours/${id}`,
      method: "delete",
    });
  }

  async deleteTimeEntryViaServerSideProxy(id) {
    await fetch(`${this.baseUrl}/time_entries/${id}`, {
      method: "delete",
      headers: {
        "X-Troi-Username": this.userName,
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
