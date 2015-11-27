var cheerio = require('cheerio');
var got = require('got');
var mtgparser = require('mtg-parser');
var Blitline = require('simple_blitline_node');
var request = require('request');
var fs = require('fs');
var Twit = require('twit');
var config = require('./config.js');

//Format urls
var standardUrl = 'http://www.mtggoldfish.com/metagame/standard#paper';
var modernUrl = 'http://www.mtggoldfish.com/metagame/modern#paper';
var legacyUrl = 'http://www.mtggoldfish.com/metagame/legacy#paper';

//Initialize array for scraped decks and urls
var deckUrls = [];
var deckNames = [];

//Image key #
var randImgKey;

//Vars for tweet params
var tDeckName;
var tDeckUrl;
var tDeckImageUrl;

//Choose which format and webpage to scrape
function randomFormat(){
	var rand = Math.floor(Math.random()*10);
	if(rand < 4){
		console.log("standard");
		query(standardUrl);
	}
	if(rand <= 7 && rand >= 4){
		console.log("modern");
		query(modernUrl);
	}
	if(rand > 7){
		console.log("legacy");
		query(legacyUrl);
	}
}

//Query the webpage
function query(baseUrl){
	got(baseUrl, scrapeMain);
}

//Scrape main webpage for content. 
function scrapeMain(err, res){
	$ = cheerio.load(res);
	$('.archetype-tile-description').map(function(i,el){
		var a = $(el).find('a');
		var link = $(a).attr('href');
		var fullLink = "http://www.mtggoldfish.com" + link;
		var title = $('.deck-price-online', el).text()
		var cleanTitle = title.replace(/(\r\n|\n|\r)/gm,"");
		
		//Add results to array
		deckUrls.push(fullLink);
		deckNames.push(cleanTitle);		
	});
	//Send results array to grab a random deck
	randomDeck(deckNames,deckUrls);
}

//Grab a random deck from scraped page
function randomDeck(rDeckName, rDeckUrl){
	var randomNum = Math.floor(Math.random()*12);
	var deckChoice = {
		deck: rDeckName[randomNum],
		url: rDeckUrl[randomNum]
	}
	getDecklist(deckChoice);
}

//Take chosen deck and grab data
function getDecklist(deckData){
	//Set global variable values
	tDeckName = deckData.deck;
	tDeckUrl = deckData.url;
	
	got(deckData.url,scrapeDeck);
}

//Scrape decklist from webpage
function scrapeDeck(err,res){
	$ = cheerio.load(res);
	var deckList = $('#deck_input_deck', res).attr('value');
	parseDeck(deckList);
}

//convert unformatted decklist string to json
function parseDeck(deckString){
	var cleanDeckString = "[DECK]" + deckString + "[/DECK]"
	var deck = mtgparser(cleanDeckString, 'mtgs');
	jsonToArray(deck);
}

//convert json to array
function jsonToArray(json){
	// console.log(json.cards[0]);
	var deckArr = [];
	var cards = json.cards;
	for(var i = 0; i < cards.length; i++){
		var card = cards[i].name;
		var num = cards[i].number;
		for(var j = 0; j <= num; j++){
			deckArr.push(card);
		}
	}
	shuffle(deckArr);
}

//randomize deck array
function shuffle(array) {
    var x = array.length, y, i;
    while (x) {
        i = ~~ (Math.random() * x--);
        y = array[x];
        array[x] = array[i];
        array[i] = y;
    }
	draw(array);
}

//Draw top seven cards from the randomized array
function draw(shufArr){
	var hand = shufArr.splice(0,7);
	createImage(hand);
}

//Take the chosen cards and create an image
function createImage(arr){
	var blitline = new Blitline();
	var applicationID = config.bitlineNum;
	var outText = arr.toString();
	var formattedString = outText.split(",").join("\n");
	randImgKey = Math.floor(Math.random()*50000);
	
	blitline.addJob({
		"application_id": applicationID,
		"src": "http://www.michaelmillerfabrics.com/media/catalog/product/cache/1/image/500x/9df78eab33525d08d6e5fb8d27136e95/j/e/jet_black_3.jpg",
		"functions": [
			{
				"name": "annotate",
				"params": {
					"text": formattedString,
					"color": '#'+Math.floor(Math.random()*16777215).toString(16),
					"point_size": "35",
					"x": 0,
					"y": 0,
					"font_family": "Arial"
				},
				"save": {
					"image_identifier": "foo", 
					"s3_destination" : {
						"bucket" : "starr-keepormullbot",
						"key" : "image.jpg"
					}
				}
			}
		]
	});
	
	//Push the image to s3
	blitline.postJobs(function(response) {
		var res = response.results[0].images[0].s3_url;
		//Set global variable value
		tDeckImageUrl = res;
		
		//callback once image has downloaded
		dlImage(function () {
			tweet();
		});
    });
}

//download image locally
function dlImage (callback) {
	var uri = "https://s3.amazonaws.com/starr-keepormullbot/" + randImgKey + ".jpg";
	var imageUri = "https://s3.amazonaws.com/starr-keepormullbot/image.jpg";
	console.log(imageUri);
	request.head(imageUri, function(err, res, body){
		console.log(res.statusCode);
		if(err) callback(err);
		else {
			request(imageUri).pipe(fs.createWriteStream("image.jpg")).on('close', callback);
		}
	});
}

//Send tweet
function tweet(){
	var T = new Twit(config);
	
	var filename = 'image.jpg';
	var params = {
		encoding: 'base64'
	}
	var b64 = fs.readFileSync(filename,params);
	T.post("media/upload", {media_data:b64}, uploaded);
	
	function uploaded(err,data,res){
		var id = data.media_id_string;
		var msg = tDeckName + "\n#keepOrMulligan ?" + "\nlink: " + tDeckUrl;
		console.log(msg);
		var tweetStatus = {
			status: msg,
			media_ids:[id]
		};
		T.post('statuses/update', tweetStatus, tweetpush);
		function tweetpush(err,data,res){
			console.log("image posted!");
		}
	}
}
// randomFormat();
setInterval(randomFormat(),1000 * 15);
