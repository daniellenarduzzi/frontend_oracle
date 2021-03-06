import React, { Component } from 'react'
import { Button, Table, Card, CardBody, Alert, Modal, ModalBody } from 'reactstrap'
import './App.css'
import Web3 from 'web3'
import jsonInterface from "./currencyOracle.json"
import moment from 'moment'
import {kovanInfuraLink} from "./config.json"

moment.locale('es')

const web3 = new Web3(Web3.givenProvider || kovanInfuraLink)
let web3ws = new Web3(new Web3.providers.WebsocketProvider("wss://kovan.infura.io/ws"))
let provider = web3ws.currentProvider;
provider.on("error", e => handleDisconnects(e));
provider.on("close", e => handleDisconnects(e));

function handleDisconnects(e) {
  console.log("error, reconecting...");
  web3ws = new Web3(new Web3.providers.WebsocketProvider("wss://kovan.infura.io/ws"));
  console.log("reconected");
  provider = web3ws.currentProvider;
  provider.on("error", e => handleDisconnects(e));
  provider.on("close", e => handleDisconnects(e));
}

class App extends Component {

  constructor(props) {
    super(props);

    this.state = {
      address: "0x6C4df0D46b045aF9090ECa162C9C66569DE92118",
      instance: "",
      signatureOfRequest: "",
      signatureOfUpdate: "",
      currencys: [],
      pastEvents: [],
      ready: false,
      ids: 0,
      from: "",
      block: 8807362,
      moreInfo: "",
      modal: false,
      MetaMaskConnected: false
    }
  }

  componentWillMount(){
    var instance = new web3.eth.Contract(jsonInterface.abi, this.state.address)

    //signature of requestCurrencyUpdateEvent
    var signatureOfRequest = web3.utils.keccak256("requestCurrencyUpdateEvent(address,uint256)")
    var signatureOfUpdate = web3.utils.keccak256("updateCurrencyEvent(uint256)")
   

    this.setState({
      instance: instance,
      signatureOfRequest: signatureOfRequest,
      signatureOfUpdate: signatureOfUpdate
    })
  }

  async componentDidMount(){
    this.getAccounts()
    this.getCurrencys()
    this.socket()
  }

  async getAccounts (){
  
    var from = await web3.eth.getAccounts()
    if(from.length === 0){
      this.setState({
        MetaMaskConnected: false
      })
    }
    else{
      this.setState({
        MetaMaskConnected: true,
        from: from[0]
      })
    }
  }

  async getCurrencys(){
    var ids = await this.state.instance.methods.ids().call()   
    for (var i = 0; i < ids; i++) {
      this.updateCurrency(i, ids)
    }
    this.getTable()
  }

  async updateCurrency(props, ids){
    var currency = await this.state.instance.methods.getCurrency(props).call()
    var update = this.state.currencys
    update[props] = currency

    update[props].disabled = false
    
    this.setState({
      currencys: update,
      ids: ids
    })
  }

  getTable = async() => {
    let res = await web3.eth.getPastLogs({
      fromBlock: this.state.block,
      toBlock: 'latest',
      address: this.state.address,
      topics: [
        [this.state.signatureOfRequest, this.state.signatureOfUpdate]
      ]
    })
    var resTable = []
    if(res.length !== 0){
      this.checkCurrencyUpdate(res)
      var table = res.reverse().slice(0, 10)
      for(var x = 0; x < table.length; x++){
        var timestamp = (await web3.eth.getBlock(table[x].blockNumber)).timestamp
        let currencyId = web3.utils.hexToNumber(table[x].data)
        resTable[x] = {}
        resTable[x].event = table[x].topics[0] === this.state.signatureOfRequest ? "Update request" : "Update successfully"
        resTable[x].date = timestamp
        resTable[x].hash = table[x].transactionHash
        resTable[x].currency = this.state.currencys[currencyId][0]
        resTable[x].block = table[x].blockNumber
      }
      
      this.setState({
        pastEvents: resTable,
        ready: true
      })      
    }else{
      this.setState({
        ready: true
      })
    }

  }

  checkCurrencyUpdate = async(res) => {
    if(res.length !== 0){
      var table = res.reverse()
      var difference = 0
      var x = 0
      var now = Date.now()/1000

      while(difference < 3 && x < table.length){
        var timeStamp = (await web3.eth.getBlock(table[x].blockNumber)).timestamp
        difference = (now - timeStamp)/60
        if(difference < 3){
          var disabled = this.state.currencys
          var currencyId = web3.utils.hexToNumber(table[x].data)
          disabled[currencyId].disabled = true
          disabled[currencyId].difference = difference

          this.setState({
            currencys: disabled
          })
        }
        x++
      }
    } 
  }
  
  socket = () => {
    web3ws.eth.subscribe('logs', {
      address: this.state.address,
      topics: [[this.state.signatureOfRequest, this.state.signatureOfUpdate]]
    })
    .on('data', (datos) => {
      var object = {}

      if (datos.topics[0] === this.state.signatureOfRequest) {
        object.event = "Update request"
      } else {
        object.event = "Update successfully"
        var currencyIdToUpdate = web3.utils.hexToNumber(datos.data)
        this.updateCurrency(currencyIdToUpdate)
        this.checkCurrencyUpdate([datos])
      }

      object.block = datos.blockNumber
      object.hash = datos.transactionHash

      var currencyId = [...datos, web3.utils.hexToNumber(datos.data)]
      object.currency = this.state.currencys[currencyId][0]
      
      var table = this.state.pastEvents

      table.unshift(object)
      table = table.slice(0, 10)
      
      this.setState({
        pastEvents: table
      })

    }).on("error", (e) =>{
      console.log(e)
    })
  }

  createTransaction(_from, _to, _amount, _data, cb) {

    if(_to === undefined)
      console.log("Missing Parameters");
    else if(_from === undefined)
      _from = web3.eth.accounts[0]

    web3.eth.sendTransaction({
      from: _from,
      to: _to,
      value: web3.utils.toWei(_amount || 0, "ether"),
      gasPrice: 1000000000,
      gas: null,
      data: _data || null
    }, (error, txHash) => {
      if(error){
        console.log(error)
        cb(error)
      }else{
        console.log(null, txHash)
        cb(null, txHash)
      }
    })
  }

  async requestUpdate(props){
    var amount = (await this.state.instance.methods.updateFee().call() / 1000000000000000000).toString()
    var data = this.state.instance.methods.requestCurrencyUpdate(props).encodeABI()
    this.createTransaction(this.state.from, this.state.address, amount, data,
      function(error, hash){
        if(error){
          console.log("Todo mal")
        } else {
          console.log(hash)
        }
    })  
  }

  toggle = () => {
    this.setState({
      modal: !this.state.modal
    });
  }

  moreInfo = async(props) => {
    var moreInfo = await web3.eth.getBlock(props)
    this.setState({
      moreInfo: moreInfo,
      modal: true
    })
  }

  render() {
    return (
    <div className="body">
      <div className="App">

      {(() => {

      if (!this.state.ready) {
        return (
            <p>Cargando... Por favor espere!</p>
          )
        }
      })()}

      {(() => {

        if (this.state.ready) {
          return (
            <div>
              <Alert color="dark">
                Dirección de contrato: {this.state.address}
              </Alert>
              <br/>
              <Table hover bordered striped responsive>
                <thead>
                  <tr>
                    <th>Evento</th>
                    <th>Fecha</th>
                    <th>Transacción ID (Hash)</th>
                    <th>Currency</th>
                    <th>Mas Información</th>
                  </tr>
                </thead>

                <tbody>

                  {(() => {
                    if (this.state.pastEvents.length === 0) {
                      return (
                      
                        <tr>
                          <td>No posee ninguna transacción</td>
                          <td>No posee ninguna transacción</td>
                          <td>No posee ninguna transacción</td>
                          <td>No posee ninguna transacción</td>
                        </tr>
                      
                      )
                    }
                  })()}

                  {this.state.pastEvents.map((dato, index) => {
                    return (
                      <tr key={index}>
                        <td>{dato.event} </td>
                        
                        {(() => {
                          if (dato.date) {
                            return (
                              <td>{moment(dato.date*1000).format("HH:mm:ss MMMM/YYYY")}</td>
                            )
                          } else {
                            return (
                              <td>Pendiente...</td>
                            })()}
                            )
                          }

                        <td><a target='_blank' href={`https://kovan.etherscan.io/tx/${dato.hash}`} >{dato.hash}</a> </td>
                        <td>{dato.currency.toUpperCase()} </td>
                        <td><Button onClick={() => this.moreInfo(dato.block)}>Mas Información</Button></td>
                      </tr>
                    )
                  })}
                  
                </tbody>
              </Table>
              <div style={{display : 'flex', flexWrap : "wrap", justifyContent : "space-around"}}>
                {this.state.currencys.map((dato, index) => {
                  return (
                    <Card key={index} className="margin-bottom">
                      {/*(() => {
                        if(this.state.currencys[index].difference){
                          
                          setTimeout(() => {
                            var change = this.state.currencys
                            change[index].disabled = !this.state.currencys[index].disabled
                            this.setState({ currencys: change });
                          }, this.state.currencys[index].difference * 60000)
                        }
                      })()*/}
                      <CardBody>
                        CURRENCY: {dato[0].toUpperCase()}<br/>
                        AVG: {Number(dato[1]).toFixed(2)}<br/>
                        BUY: {Number(dato[2]).toFixed(2)}<br/>
                        SELL: {Number(dato[3]).toFixed(2)}
                      </CardBody>
                      <Button disabled={this.state.currencys[index].disabled}
                      onClick={() => this.requestUpdate(index)}>Update</Button>
                    </Card>
                  )
                })}
              </div>
            </div>

            )
          }
        })()}

      </div>

      <Modal isOpen={this.state.modal} toggle={this.toggle} className={this.props.className}>
          
      <ModalBody>
        <Table hover bordered striped responsive>
            <thead>
            <tr>
              <th>Gas usado</th>
              <th>Número de Bloque</th>
              <th>Miner</th>
            </tr>
            </thead>
            <tbody>

              <tr>
                <td>{this.state.moreInfo.gasUsed}</td>
                <td>{this.state.moreInfo.number}</td>
                <td>{this.state.moreInfo.miner}</td>
              </tr>
            
            </tbody>
          </Table>
        </ModalBody>
          
      </Modal>
    </div>
    );
  }
}

export default App;


/*
estimateGas(to , props){
    web3.eth.estimateGas({
      to: to,
      data: props
    }, (data, error) => {
      if(error)
        return error
      else
        return data
    })
  }

checkInstalled (){
  if(typeof web3 === 'undefined' || !web3.currentProvider.isMetaMask)
    return false;
  else 
    return true;
};

getAccounts (){
  if(web3.eth.accounts.length === 0 || web3.eth.accounts == null)
    console.log("Accounts not found or MetaMask probably unlocked");
  else
    return web3.eth.accounts;
};

getNetworkId(cb){
  web3.version.getNetwork((err, netId) => {
    if(err)
      cb(err)
    else
      cb(null, netId);
  });
};*/
