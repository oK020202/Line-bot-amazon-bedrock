import * as cdk from 'aws-cdk-lib';
import {
  aws_apigateway as apigateway,
  aws_dynamodb as dynamodb,
  aws_sqs as sqs,
  aws_ssm as ssm,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { SsmParameterNames } from './ssm-parameter-names';
import { RequestHandler } from './components/request-handler';
import { StateMachine } from './components/state-machine';
import { EventBridgePipes } from './components/pipes';

export class Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------
    // SQS
    // -----------------------------
    const queue = new sqs.Queue(this, 'RequestQueue', {
    });

    // -----------------------------
    // DynamoDB Table
    // -----------------------------
    const table = new dynamodb.Table(this, 'HistoryTable', {
      partitionKey: {
        name: 'chat_id',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -----------------------------
    // SSM Parameter (for prompt template)
    // -----------------------------
    new ssm.StringParameter(this, 'ParameterPromptTemplate', {
      parameterName: SsmParameterNames.PROMPT_TEMPLATE,
      stringValue: '{}\n\nHuman: {}\n\nAssistant:',
    });

    // -----------------------------
    // Request Handler
    // -----------------------------
    const requestHandler = new RequestHandler(this, {
      queue: queue
    });

    // -----------------------------
    // API Gateway
    // -----------------------------
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'line-bot-with-amazon-bedrock',
      endpointTypes:[ apigateway.EndpointType.REGIONAL ],
      deployOptions: {
        dataTraceEnabled: false,
        stageName: 'prod',
        cachingEnabled: false,
        loggingLevel: apigateway.MethodLoggingLevel.ERROR,
        tracingEnabled: true,
      },
    });

    api.root.addMethod('POST', new apigateway.LambdaIntegration(requestHandler.lambdaFunction));

    // -----------------------------
    // Workflow (Step Functions)
    // -----------------------------
    const stateMachine = new StateMachine(this, {
      table: table,
    });

    // -----------------------------
    // EventBridge Pipes
    // -----------------------------
    new EventBridgePipes(this, {
      source: queue,
      destination: stateMachine,
    })

    // -----------------------------
    // Output
    // -----------------------------
  }
}
