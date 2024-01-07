import * as cdk from 'aws-cdk-lib';
import {
  aws_bedrock as bedrock,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_iam as iam,
  aws_logs as logs,
  aws_ssm as ssm,
  aws_stepfunctions as sfn,
  aws_stepfunctions_tasks as tasks,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { SsmParameterNames } from '../ssm-parameter-names';

type StateMachineProps = {
  table: dynamodb.ITable;
}

export class StateMachine {

  public readonly stateMachine: sfn.StateMachine;

  constructor (scope: Construct, props: StateMachineProps){

    // LogGroup for State Machine
    const logGroup = new logs.LogGroup(scope, 'StateMachineLogs', {
      logGroupName: `/aws/statemachine/${scope.toString()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.THREE_MONTHS
    });

    // -----------------------------
    // Connection
    // -----------------------------
    const connection = new events.Connection(scope, 'LineEndpointConnection', {
      authorization: events.Authorization.apiKey(
        'Authorization',
        cdk.SecretValue.unsafePlainText(`Bearer ${ssm.StringParameter.valueForStringParameter(scope, SsmParameterNames.LINE_CHANNEL_ACCESS_TOKEN)}`)
      ),
    });

    // -----------------------------
    // IAM Role
    // -----------------------------

    // IAM Policy
    const policyDocument = new iam.PolicyDocument({
      statements:[
        // new iam.PolicyStatement({
        //   effect: iam.Effect.ALLOW,
        //   actions: [
        //     'logs:CreateLogGroup',
        //     'logs:CreateLogStream',
        //     'logs:PutLogEvents'
        //   ],
        //   resources: [
        //     logGroup.logGroupArn,
        //     `${logGroup.logGroupArn}:*`
        //   ],
        // }),
        // new iam.PolicyStatement({
        //   effect: iam.Effect.ALLOW,
        //   actions: [
        //     'dynamodb:GettItem',
        //     'dynamodb:PutItem',
        //   ],
        //   resources: [
        //     props.table.tableArn,
        //   ],
        // }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'states:InvokeHTTPEndpoint',
          ],
          resources: [ '*' ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'events:RetrieveConnectionCredentials',
          ],
          resources: [
            connection.connectionArn,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
          ],
          resources: [
            connection.connectionSecretArn,
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets'
          ],
          resources: [ '*' ]
        }),
      ]
    });
    // IAM Role
    const role = new iam.Role(scope, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        'policy': policyDocument,
      },
    });

    // -----------------------------
    // Tasks
    // -----------------------------
    const taskLoadHistory = new tasks.DynamoGetItem(scope, 'Load History', {
      table: props.table,
      key: {
        chat_id: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.chatId')),
      },
      inputPath: '$[0].body',
      resultPath: '$[0].LoadHistory',
      outputPath: '$[0]',
    });

    // const taskLoadHistory = new tasks.CallAwsService(scope, 'Load History', {
    //   action: 'getItem',
    //   iamResources: [
    //     props.table.tableArn,
    //   ],
    //   service: 'dynamodb',
    //   parameters: {
    //     "TableName": props.table.tableName,
    //     "Key": {
    //       "chat_id": {
    //         "S.$": "$.chatId"
    //       }
    //     }
    //   },
    //   inputPath: '$[0].body',
    //   resultPath: '$[0].LoadHistory',
    //   outputPath: '$[0]',
    // });

    const taskLoadPrompTemplate = new tasks.CallAwsService(scope, 'Load Prompt Template', {
      action: 'getParameter',
      iamResources: [
        '*',
      ],
      service: 'ssm',
      parameters: {
        "Name": SsmParameterNames.PROMPT_TEMPLATE
      },
      inputPath: '$[0].body',
      resultSelector: {
        "Value.$": "$.Parameter.Value"
      },
      resultPath: '$[0].LoadPromptTemplate',
      outputPath: '$[0]',
    });

    const taskExistsHistory = new sfn.Pass(scope, 'Exists History', {
      parameters: {
        "body.$": "$.body",
        "LoadHistory.$": "$.LoadHistory.Item",
      },
    });

    const taskNotExistsHistory = new sfn.Pass(scope, 'Not Exists History', {
      parameters: {
        "body.$": "$.body",
        "LoadHistory": {
          "history": {
            "S": ""
          }
        }
      },
    });

    const choiceHasHistory = new sfn.Choice(scope, 'Has History').when(
      sfn.Condition.isPresent('$.LoadHistory.Item'),
      taskExistsHistory
    ).otherwise(
      taskNotExistsHistory
    );

    const taskFlatten = new sfn.Pass(scope, 'Flatten', {
      parameters: {
        "body.$": "$[0].body",
        "LoadHistory.$": "$[0].LoadHistory",
        "LoadPromptTemplate.$": "$[1].LoadPromptTemplate"
      }
    });

    const taskInvokeModel = new tasks.BedrockInvokeModel(scope, 'Invoke Model', {
      model: bedrock.FoundationModel.fromFoundationModelId(scope, 'Model', bedrock.FoundationModelIdentifier.ANTHROPIC_CLAUDE_V2_1),
      body: sfn.TaskInput.fromObject({
        "prompt.$": "States.Format($.LoadPromptTemplate.Value, $.LoadHistory.history.S, $.body.message)",
        "max_tokens_to_sample": 500,
        "temperature": 0.5,
        "top_p": 1.0,
        "top_k": 250,
      }),
      accept: 'application/json',
      contentType: 'application/json',
      resultPath: '$.InvokeModel',
    });

    const taskSendLineResponse = new sfn.CustomState(scope, 'Send LINE Response', {
      stateJson: {
        "Type": "Task",
        "Resource": "arn:aws:states:::http:invoke",
        "Parameters": {
          "ApiEndpoint": "https://api.line.me/v2/bot/message/reply",
          "Method": "POST",
          "RequestBody": {
            "replyToken.$": "$.body.replyToken",
            "messages": [
              {
                "type": "text",
                "text.$": "$.InvokeModel.Body.completion"
              }
            ]
          },
          "Authentication": {
            "ConnectionArn": connection.connectionArn
          }
        },
        "Retry": [
          {
            "ErrorEquals": [
              "States.ALL"
            ],
            "BackoffRate": 2,
            "IntervalSeconds": 1,
            "MaxAttempts": 3,
            "JitterStrategy": "FULL"
          }
        ],
        "End": true,
        "ResultPath": "$.SendLineResponse"
      }
    });

    // const taskSaveHistory = new tasks.DynamoPutItem(scope, 'Save History', {
    //   table: props.table,
    //   item: {
    //     chat_id: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.body.chatId')),
    //     history: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('States.Format("{}\n\nHuman: {}\n\nAssistant: {}", $.LoadHistory.history.S, $.body.message, $.InvokeModel.Body.completion)')),
    //     ttl: tasks.DynamoAttributeValue.numberFromString(sfn.JsonPath.stringAt(`States.Format("{}", States.MathAdd($.body.timestampSecond, 3600))`)),
    //   },
    //   resultPath: '$.SaveHistory',
    // });

    const taskSaveHistory = new tasks.CallAwsService(scope, 'Save History', {
      action: 'putItem',
      iamResources: [
        props.table.tableArn,
      ],
      service: 'dynamodb',
      parameters: {
        "TableName": props.table.tableName,
        "Item": {
          "chat_id": {
            "S.$": "$.body.chatId"
          },
          "history": {
            "S.$": "States.Format('{}\n\nHuman: {}\n\nAssistant: {}', $.LoadHistory.history.S, $.body.message, $.InvokeModel.Body.completion)"
          },
          "ttl": {
            "N.$": "States.Format('{}', States.MathAdd($.body.timestampSecond, 3600))"
          }
        }
      },
      resultPath: '$.SaveHistory',
    });

    const parallelPrepare = new sfn.Parallel(scope, 'Prepare')
      .branch(taskLoadHistory)
      .branch(taskLoadPrompTemplate);

    const parallelResponse = new sfn.Parallel(scope, 'Parallel')
      .branch(taskSendLineResponse)
      .branch(taskSaveHistory);

    taskLoadHistory.next(choiceHasHistory);
    parallelPrepare.next(taskFlatten);
    taskFlatten.next(taskInvokeModel);
    taskInvokeModel.next(parallelResponse);

    const stateMachine = new sfn.StateMachine(scope, 'StateMachine', {
      role: role,
      logs: {
        destination: logGroup,
        includeExecutionData: true,
        level: sfn.LogLevel.ERROR,
      },
      timeout: cdk.Duration.seconds(60),
      tracingEnabled: true,
      definitionBody: sfn.DefinitionBody.fromChainable(
        parallelPrepare
      ),
    });

    this.stateMachine = stateMachine;
  }
}