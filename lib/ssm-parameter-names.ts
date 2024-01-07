
export class SsmParameterNames {
  public static readonly PREFIX: string = '/line-bot-with-amazon-bedrock';

  public static readonly LINE_CHANNEL_ACCESS_TOKEN: string = `${this.PREFIX}/line_channel_access_token`;
  public static readonly LINE_CHANNEL_SECRET: string = `${this.PREFIX}/line_channel_secret`;

  public static readonly PROMPT_TEMPLATE: string = `${this.PREFIX}/prompt-template`;
}