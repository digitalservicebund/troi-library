import debugModule from "debug";
import md5 from "crypto-js/md5.js";
import fetch from "isomorphic-fetch";

const debug = debugModule("troi");

export class AuthenticationFailed extends Error {
  constructor() {
    super("Troi Authentication Failed");
    this.name = this.constructor.name;
  }
}

export type TimeEntry = {
  id: number,
  date: string,
  hours: number,
  description: string,
}

export type CalenderEventType = "R" | "H" | "G" | "P" | "T"

export type CalenderEvent = {
  id: string;
  startDate: string;
  endDate: string;
  subject: string;
  type: CalenderEventType;
}

export type CalculationPosition = {
  name: string;
  id: number;
}

/**
 * Creates an instance of the TroiApiService.
 * @class
 */
export default class TroiApiService {
  baseUrl: string
  clientName: string
  username: string
  password: string
  authHeader: {
    Authorization: string
  };
  clientId?: number;
  employeeId?: number;


  /**
   * @constructor
   * @param {Object} initializationObject - An object to initialize the service
   * @param {string} initializationObject.baseUrl - The troi url for your company
   * @param {string} initializationObject.clientName - The clientName to get the company id for bookings
   * @param {string} initializationObject.username - The username to be used for all operations
   * @param {string} initializationObject.password - The users password to be used for all operations
   */
  constructor({ baseUrl, clientName, username, password }: {
    baseUrl: string,
    clientName: string,
    username: string,
    password: string,
  }) {
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
   * @returns {Promise<number>} the clientId
   */
  async getClientId(): Promise<number> {
    const client = await this.makeRequest({
      url: "/clients",
      predicate: (obj: unknown) => (obj as any).Name === this.clientName,
    });
    return (client as any).Id;
  }

  /**
   *
   * @name getEmployeeId
   * @description retrieve the id of the employee for future operations
   * @returns {Promise<number>} the employeeId
   */
  async getEmployeeId(): Promise<number> {
    const employees = await this.makeRequest({
      url: "/employees",
      params: {
        clientId: this.clientId.toString(),
        employeeLoginName: this.username,
      },
    });
    return employees[0].Id;
  }

  async getCalculationPositions(favouritesOnly: boolean = true): Promise<CalculationPosition[]> {
    const calculationPositions = await this.makeRequest({
      url: "/calculationPositions",
      params: {
        clientId: this.clientId.toString(),
        favoritesOnly: `${favouritesOnly}`,
        timeRecording: true.toString()
      },
    });
    return (calculationPositions as any).map((obj: unknown) => {
      return {
        name: (obj as any).DisplayPath,
        id: (obj as any).Id,
      };
    });
  }

  async getTimeEntries(calculationPositionId: number, startDate: string, endDate: string): Promise<TimeEntry[]> {
    const timeEntries = await this.makeRequest({
      url: "/billings/hours",
      params: {
        clientId: this.clientId.toString(),
        employeeId: this.employeeId.toString(),
        calculationPositionId: calculationPositionId.toString(),
        startDate: startDate,
        endDate: endDate,
      },
    });
    return (timeEntries as any)
      .map((obj: unknown): TimeEntry => {
        return {
          id: (obj as any).id,
          date: (obj as any).Date,
          hours: (obj as any).Quantity,
          description: (obj as any).Remark,
        };
      })
      .sort((a: TimeEntry, b: TimeEntry) => (a.date > b.date ? 1 : -1));
  }

  async postTimeEntry(calculationPositionId: number, date: string, hours: number, description: string): Promise<unknown> {
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

    return await this.makeRequest({
      url: "/billings/hours",
      headers: { "Content-Type": "application/json" },
      method: "post",
      body: JSON.stringify(payload),
    });
  }

  async updateTimeEntry(
    calculationPositionId: number,
    date: string,
    hours: number,
    description: string,
    billingId: number
  ): Promise<unknown> {
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

    return await this.makeRequest({
      url: `/billings/hours/${billingId}`,
      headers: { "Content-Type": "application/json" },
      method: "put",
      body: JSON.stringify(payload),
    });
  }

  async deleteTimeEntry(id: number): Promise<unknown> {
    return await this.makeRequest({
      url: `/billings/hours/${id}`,
      method: "delete",
    });
  }

  async deleteTimeEntryViaServerSideProxy(id: number): Promise<unknown> {
    return await fetch(`/time_entries/${id}`, {
      method: "delete",
      headers: {
        "X-Troi-Username": this.username,
        "X-Troi-Password": this.password,
      },
    });
  }

  async makeRequest(options: RequestInit & {url: string, params?: string | Record<string, string> | URLSearchParams | string[][], predicate?: (response: unknown) => boolean}): Promise<unknown> {
    const defaultOptions = {
      method: "get",
      params: undefined,
      headers: {},
      body: undefined,
    };
    options = { ...defaultOptions, ...options };
    const { url, method, params, headers, body } = options;

    const requestUrl = `${this.baseUrl}${url}${params ? `?${new URLSearchParams(params)}` : ""
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

  async getCalendarEvents(startDate: string, endDate: string, type: CalenderEventType | "" = ""): Promise<CalenderEvent[]> {
    const calendarEvents = await this.makeRequest({
      url: "/calendarEvents",
      params: {
        start: startDate,
        end: endDate,
        type: type,
      },
    }) || [];

    return (calendarEvents as any)
      .map((obj) => {
        return {
          id: obj.id,
          startDate: obj.Start,
          endDate: obj.End,
          subject: obj.Subject,
          type: obj.Type,
        };
      })
      .sort((a: CalenderEvent, b: CalenderEvent) => (a.startDate > b.startDate ? 1 : -1));
  }
}
