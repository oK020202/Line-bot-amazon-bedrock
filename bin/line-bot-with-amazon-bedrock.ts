import * as cdk from 'aws-cdk-lib';
import { Stack } from '../lib/stack';
import { ParameterStack } from '../lib/parameter-stack';

const app = new cdk.App();

const parameterStack = new ParameterStack(app, 'LineBotWithAmazonBedrockParameter');

const mainStack = new Stack(app, 'LineBotWithAmazonBedrock');
mainStack.addDependency(parameterStack);

// cdk.Tags.of(app).add('tag-name', 'tag-value');