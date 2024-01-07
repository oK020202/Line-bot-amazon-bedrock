import {
  aws_ssm as ssm,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { SsmParameterNames } from './ssm-parameter-names';

interface LineChannelParameter {
  readonly accessToken: string,
  readonly secret: string,
}

export class ParameterStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const param = this.node.tryGetContext('line-bot-with-amazon-bedrock') as LineChannelParameter;

    new ssm.StringParameter(this, 'ParameterLineChannelAccessToken', {
      parameterName: SsmParameterNames.LINE_CHANNEL_ACCESS_TOKEN,
      stringValue: param.accessToken,
    });

    new ssm.StringParameter(this, 'ParameterLineChannelSecret', {
      parameterName: SsmParameterNames.LINE_CHANNEL_SECRET,
      stringValue: param.secret,
    });
  }
}