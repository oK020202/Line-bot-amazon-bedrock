import {
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambda_nodejs,
  aws_sqs as sqs,
  aws_ssm as ssm,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { SsmParameterNames } from '../ssm-parameter-names';

export interface RequestHandlerProps {
  queue: sqs.Queue
}

export class RequestHandler {

  public readonly lambdaFunction: lambda.Function;

  constructor(scope: Construct, props: RequestHandlerProps){

    // -----------------------------
    // Lambda
    // -----------------------------

    const role = new iam.Role(scope, 'RequestHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        'policy': new iam.PolicyDocument({
          statements:[
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:SendMessage',
              ],
              resources: [
                props.queue.queueArn
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'xray:PutTraceSegments',
                'xray:PutTelemetryRecords',
              ],
              resources: [ '*' ],
            }),
          ]
        })
      },
    });

    const lambdaFunction = new lambda_nodejs.NodejsFunction(scope, 'RequestHandler', {
      entry: 'assets/functions/request-handler/app.ts',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      awsSdkConnectionReuse: false,
      role: role,
      timeout: Duration.seconds(60),
      environment: {
        LINE_CHANNEL_ACCESS_TOKEN: ssm.StringParameter.valueForStringParameter(scope, SsmParameterNames.LINE_CHANNEL_ACCESS_TOKEN),
        LINE_CHANNEL_SECRET: ssm.StringParameter.valueForStringParameter(scope, SsmParameterNames.LINE_CHANNEL_SECRET),
        QUEUE_URL: props.queue.queueUrl,
      },
      logFormat: lambda.LogFormat.JSON,
      systemLogLevel: lambda.SystemLogLevel.WARN,
      tracing: lambda.Tracing.DISABLED,
    });

    this.lambdaFunction = lambdaFunction;
  }
}
