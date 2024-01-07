import * as crypto from 'crypto';
import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  APIGatewayProxyEventHeaders,
  Context,
} from 'aws-lambda';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import * as Line from '@line/bot-sdk';
import * as Types from '@line/bot-sdk/lib/types';

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET!;
const QUEUE_URL = process.env.QUEUE_URL!;

const config: Line.ClientConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};
const line = new Line.Client(config);

const sqs = new SQSClient({});

async function eventHandler(event: Line.WebhookEvent): Promise<any> {
  if (event.type !== 'message') {
    console.debug("event type is not 'message'.");
    return {
      statusCode: 400,
      body: 'Bad Request',
    };
  }

  const messageEvent = event as Line.MessageEvent;
  const messageId = messageEvent.message.id;
  const userId = messageEvent.source.userId;
  const groupId = messageEvent.source.type === 'group' ? messageEvent.source.groupId : '';
  const replyToken = messageEvent.replyToken;
  const timestamp = messageEvent.timestamp;

  const chatId = crypto.createHash('sha256').update((groupId === '' ? userId! : groupId)).digest('hex');
  const timestampSecond = Math.round(timestamp / 1000);

  const replyMessage: Types.Message = { type: "text", text: "Sorry, cannot accept your message. Please retry." };
  if (event.message.type !== 'text'){
    console.debug("message type is not text.");
    return {
      statusCode: 400,
      body: 'Bad Request',
    }
  }

  console.debug(`message : ${event.message.text}`);

  let mode = 'chat';
  let message = event.message.text;

  try {
    const request = {
      messageId: messageId,
      chatId: chatId,
      userId: userId,
      groupId: groupId,
      replyToken: replyToken,
      timestampSecond: timestampSecond,
      timestamp: timestamp,
      message: message,
      mode: mode,
    };

    const output = sqs.send(new SendMessageCommand({
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify(request)
    }));

    const statusCode = (await output).$metadata.httpStatusCode;

    if (statusCode !== 200){
      return line.replyMessage(event.replyToken, replyMessage);
    }
  }
  catch (error){
    console.error(error);
  }
}

const getLineSignature = (headers: APIGatewayProxyEventHeaders): string => {
  if ('x-line-signature' in headers){
    return headers['x-line-signature']!;
  }
  else if ('X-Line-Signature' in headers){
    return headers['X-Line-Signature']!;
  }
  else{
    return '';
  }
};

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
  console.debug(event);

  const signature = getLineSignature(event.headers);
  if (!Line.validateSignature(event.body!, LINE_CHANNEL_SECRET, signature)) {
    throw new Line.SignatureValidationFailed('signature validation failed', signature);
  }

  const body: Line.WebhookRequestBody = JSON.parse(event.body!);
  await Promise
    .all(body.events.map( async e => eventHandler(e)))
    .catch( err => {
      console.error(err.Message);
      return {
        statusCode: 500,
        body: 'Error'
      }
    });

  return {
    statusCode: 202,
    body: 'Accepted',
  };
};
