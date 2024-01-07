import * as cdk from 'aws-cdk-lib';
import {
  aws_iam as iam,
  aws_logs as logs,
  aws_pipes as pipes,
  aws_sqs as sqs,
  Stack
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StateMachine } from './state-machine';

export interface EventBridgePipesProps {
  source: sqs.Queue,
  destination: StateMachine
}

export class EventBridgePipes {
  constructor (scope: Construct, props: EventBridgePipesProps){

    const accountId = Stack.of(scope).account;

    const logGroup = new logs.LogGroup(scope, 'PipesLogs', {
      logGroupName: `/aws/vendedlogs/pipes/${scope.toString()}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_MONTH
    });

    const role = new iam.Role(scope, 'PipesRole', {
      assumedBy: new iam.PrincipalWithConditions(
        new iam.ServicePrincipal('pipes.amazonaws.com'),
        {
          'StringEquals': {
            'aws:SourceAccount' : accountId
          }
        }
      ),
      inlinePolicies: {
        'policy': new iam.PolicyDocument({
          statements:[
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'states:StartExecution',
              ],
              resources: [
                props.destination.stateMachine.stateMachineArn
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ],
              resources: [
                props.source.queueArn
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
              ],
              resources: [
                logGroup.logGroupArn,
                `${logGroup.logGroupArn}:*`
              ],
            }),
          ]
        })
      }
    });

    new pipes.CfnPipe(scope, 'Pipes', {
      roleArn: role.roleArn,
      source: props.source.queueArn,
      target: props.destination.stateMachine.stateMachineArn,
      sourceParameters: {
        sqsQueueParameters: {
          batchSize: 1,
          maximumBatchingWindowInSeconds: 10
        }
      },
      targetParameters: {
        stepFunctionStateMachineParameters: {
          invocationType: 'FIRE_AND_FORGET'
        },
        inputTemplate: "{\"messageId\": <$.messageId>,\"receiptHandle\": <$.receiptHandle>,\"body\": <$.body>,\"attributes\": <$.attributes>,\"messageAttributes\": <$.messageAttributes>,\"md5OfMessageAttributes\": <$.md5OfMessageAttributes>,\"md5OfBody\": <$.md5OfBody>,\"awsRegion\":<$.awsRegion>,\"eventSourceARN\": <$.eventSourceARN>}"
      },
      logConfiguration: {
        cloudwatchLogsLogDestination: {
          logGroupArn: logGroup.logGroupArn,
        },
        level: 'ERROR', // OFF | ERROR | INFO | TRACE
        // includeExecutionData: [
        //   'payload',
        //   'awsRequest',
        //   'awsResponse',
        // ],
      }
    });
  }
}