import { contract } from "@sendlit/api-contract";
import type { Body, HttpClient, Ok } from "../http";

const routes = contract.settings.general;

/** The team's general settings, such as the mailing address that broadcasts
 * and sequences need before they can send. */
export type GeneralSettings = Ok<typeof routes.get>;
export type UpdateGeneralSettingsInput = Body<typeof routes.update>;
/** A mailing address as separate fields; SendLit formats the footer's
 * `mailingAddress` text from it. */
export type PostalAddress = NonNullable<GeneralSettings["postalAddress"]>;

export class GeneralSettingsResource {
  constructor(private readonly http: HttpClient) {}

  async get(): Promise<GeneralSettings> {
    return this.http.request(routes.get);
  }

  async update(input: UpdateGeneralSettingsInput): Promise<GeneralSettings> {
    return this.http.request(routes.update, { body: input });
  }
}

export class Settings {
  readonly general: GeneralSettingsResource;

  constructor(http: HttpClient) {
    this.general = new GeneralSettingsResource(http);
  }
}
