## Development Tips

- OpenAPI best practices: Keep schemas/routes generated from the `ts-rest` contract. Define OpenAPI security schemes in the OpenAPI wrapper. Use global `security` for the default auth behavior. Use `operationMapper` for exceptions like `/provisioning/teams`.
